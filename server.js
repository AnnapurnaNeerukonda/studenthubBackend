const PORT = process.env.PORT || 4000;
const express = require('express');
const app = express();
const admin = require('firebase-admin');
const bcrypt = require('bcrypt');
const cors = require('cors');
const jwt = require('jsonwebtoken'); 
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const upload = multer();
const serviceAccount = require("./newkey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'hackthon-fe388.appspot.com'
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.post('/registerUser', async (req, res) => {
  try {
    const { username, email, password, gender } = req.body;
    console.log(email);
    console.log(password);
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if the email is already in use
    const existingUser = await admin.auth().getUserByEmail(email).catch((error) => {
      if (error.code === 'auth/user-not-found') {
        return null;
      }
      throw error;
    });

    if (existingUser) {
      return res.status(400).json({ message: 'The email address is already in use by another account.' });
    }

    // Proceed with creating the user
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });

    const userUid = userRecord.uid;

    await admin.firestore().collection('users').doc(userUid).set({
      username,
      email,
      gender,
      passwordHash: hashedPassword,
    });

    // Respond with the correct structure
    res.json({ message: 'Registration successful', uid: userUid });
  } catch (error) {
    console.error('Error in registration:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});


app.post('/loginUser', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log( email) ;
    console.log(password);
    const userRecord = await admin.auth().getUserByEmail(email);

    if (userRecord) {
      const userDocRef = admin.firestore().collection('users').doc(userRecord.uid);
      const userDoc = await userDocRef.get();

      if (userDoc.exists) {
        const storedHashedPassword = userDoc.data().passwordHash; // Corrected field name

        const isPasswordValid = await bcrypt.compare(password, storedHashedPassword);

        if (isPasswordValid) {
          const token = jwt.sign({ uid: userRecord.uid, email: userRecord.email }, 'your-secret-key');
          res.header('Authorization', `Bearer ${token}`);
          res.json({
            message: 'Login successful',
            userData: { email: userRecord.email, uid: userRecord.uid, token: token },
          });
        } else {
          res.status(401).json({ message: 'Invalid email or password' });
        }
      } else {
        res.status(404).json({ message: 'User not found in Firestore' });
      }
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error('Error during login:', error);

    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      res.status(401).json({ message: 'Invalid email or password' });
    } else {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});
app.post("/create-post", upload.single("image"), async (req, res) => {
  try {
    const { title, description, uid } = req.body;
    const { buffer } = req.file;

    // Upload the image to Firebase Storage
    const imageFilename = `${uuidv4()}.jpg`;
    const storageRef = admin.storage().bucket().file(imageFilename);
    await storageRef.save(buffer, { contentType: "image/jpeg" });

    // Get the URL of the uploaded image
    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${
      storageRef.bucket.name
    }/o/${encodeURIComponent(imageFilename)}?alt=media`;
    // Get the current date
    const currentDate = new Date();

    const post = {
      uid,
      title,
      description,
      imageUrl,
      date: currentDate,
      likesCount: 0,
    };

    const pendingPostsCollectionRef = admin
      .firestore()
      .collection("posts");
    await pendingPostsCollectionRef.add(post);

    res.json({ message: "Post created successfully" });
  } catch (error) {
    console.error("Error in create-post route:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post("/dislike-post", async (req, res) => {
  const { postId, uid } = req.body;

  // Validate that postId and uid are provided and are non-empty strings
  if (!postId || typeof postId !== "string" || postId.trim() === "") {
    return res.status(400).json({ error: "Invalid or missing postId" });
  }
  if (!uid || typeof uid !== "string" || uid.trim() === "") {
    return res.status(400).json({ error: "Invalid or missing uid" });
  }

  try {
    await admin.firestore().runTransaction(async (transaction) => {
      const postRef = admin.firestore().collection("posts").doc(postId);
      const doc = await transaction.get(postRef);

      if (!doc.exists) {
        return res.status(404).json({ error: "Post not found" });
      }

      const postData = doc.data();
      const likesCount = postData?.likesCount || 0;
      const likedBy = postData?.likedBy || [];

      if (!likedBy.includes(uid)) {
        return res.status(400).json({ error: "User has not liked this post yet" });
      }

      // If the user has already liked the post, remove their like
      transaction.update(postRef, {
        likedBy: admin.firestore.FieldValue.arrayRemove(uid),
        likesCount: Math.max(likesCount - 1, 0), // Decrement the like count
      });

      // No response is sent inside the transaction
    });

    // Send the response after the transaction has successfully committed
    return res.json({ message: "Post disliked successfully" });
  } catch (error) {
    console.error("Error disliking post:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


app.post('/update-profile-pic', upload.single('profilePic'), async (req, res) => {
  const { uid } = req.body; // Assuming UID is sent in body or use auth context

  if (!uid) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const profilePicUrl = `http://localhost:4000/uploads/${req.file.filename}`; // Adjust URL if necessary

  try {
    const userDocRef = admin.firestore().collection('users').doc(uid);
    await userDocRef.update({ profilePic: profilePicUrl });
    res.json({ profilePic: profilePicUrl });
  } catch (error) {
    console.error('Error updating profile picture:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});
app.get('/user-details/:uid', async (req, res) => {
  const { uid } = req.params;

  if (!uid) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  try {
    const userDocRef = admin.firestore().collection('users').doc(uid);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    res.json(userData); // Changed to send user data directly
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});

app.post("/like-post", async (req, res) => {
  const { postId, uid } = req.body;  // Use req.body instead of req.query

  try {
    await admin.firestore().runTransaction(async (transaction) => {
      const postRef = admin.firestore().collection("posts").doc(postId);
      const doc = await transaction.get(postRef);

      if (doc.exists) {
        const postData = doc.data();
        const likesCount = postData?.likesCount || 0;
        const likedBy = postData?.likedBy || [];

        // Check if the user already liked the post
        if (likedBy.includes(uid)) {
          // Dislike (remove like)
          await transaction.update(postRef, {
            likedBy: admin.firestore.FieldValue.arrayRemove(uid),
            likesCount: likesCount > 0 ? likesCount - 1 : 0,
          });
          return res.json({ message: "Post disliked successfully" });
        } else {
          // Like the post
          await transaction.update(postRef, {
            likedBy: admin.firestore.FieldValue.arrayUnion(uid),
            likesCount: likesCount + 1,
          });
          return res.json({ message: "Post liked successfully" });
        }
      } else {
        return res.status(404).json({ error: "Post not found" });
      }
    });
  } catch (error) {
    console.log("Error in transaction:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


app.get("/get-newsfeed", async (req, res) => {
  console.log("get-newsfeed route hit");
  try {
    const pageSize = 5; // Number of posts per page
    const currentPage = parseInt(req.query.page) || 1; // Current page number, default is 1

    const postsCollectionRef = admin.firestore().collection("posts");

    let postsQuery = postsCollectionRef.orderBy("date", "desc").limit(pageSize);

    // If not on the first page, apply pagination
    if (currentPage > 1) {
      const lastPostSnapshot = await postsCollectionRef
        .orderBy("date", "desc")
        .limit((currentPage - 1) * pageSize)
        .get();

      if (!lastPostSnapshot.empty) {
        const lastPost = lastPostSnapshot.docs[lastPostSnapshot.docs.length - 1];
        postsQuery = postsQuery.startAfter(lastPost);
      }
    }

    const postsQuerySnapshot = await postsQuery.get();

    if (!postsQuerySnapshot.empty) {
      const postsData = [];
      const userDetailsPromises = [];

      postsQuerySnapshot.forEach((doc) => {
        const postData = doc.data();
        const userDetailsPromise = admin
          .firestore()
          .collection("users")
          .doc(postData.uid) // Directly use the uid to fetch the user document
          .get()
          .then((userSnapshot) => {
            if (userSnapshot.exists) {
              const userData = userSnapshot.data();
              return {
                username: userData.username, // Retrieve the username specifically
                ...userData, // Optionally, spread other user details if needed
              };
            } else {
              // If user details not found, return null or handle accordingly
              return null;
            }
          });
        userDetailsPromises.push(userDetailsPromise);

        postsData.push({
          ...postData,
          id: doc.id,
        });
      });

      const userDetailsSnapshots = await Promise.all(userDetailsPromises);

      const mergedPostsData = postsData.map((postData, index) => {
        return {
          ...postData,
          userDetails: userDetailsSnapshots[index],
        };
      });

      res.json({ posts: mergedPostsData });
    } else {
      res.status(404).json({ message: "No posts found" });
    }
  } catch (error) {
    console.error("Error in get-newsfeed route:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post('/api/todo', async (req, res) => {
  const { user, title, is_finished } = req.body;
  try {
    await db.collection('todos').add({
      user,
      title,
      is_finished,
    });
    res.status(201).json({ message: 'Todo added successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Error adding todo.' });
  }
});


app.get('/api/todo/:user', async (req, res) => {
  try {
    const todosSnapshot = await db.collection('todos').where('user', '==', req.params.user).get();
    const todos = todosSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(todos);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching todos.' });
  }
});

app.put('/api/todo/:id', async (req, res) => {
  try {
    const todoRef = db.collection('todos').doc(req.params.id);
    const todo = await todoRef.get();
    if (!todo.exists) {
      return res.status(404).json({ message: 'Todo not found.' });
    }
    const updatedIsFinished = !todo.data().is_finished;
    await todoRef.update({ is_finished: updatedIsFinished });
    res.json({ message: 'Todo updated successfully!' });
  } catch (err) {
    res.status(500).json({ message: 'Error updating todo.' });
  }
});



app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});