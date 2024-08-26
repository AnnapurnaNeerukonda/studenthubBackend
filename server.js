const PORT = process.env.PORT || 4001;
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

    const hashedPassword = await bcrypt.hash(password, 10); 

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

    // Create a new post object
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

    // Add the new post document to the "pending" subcollection
    await pendingPostsCollectionRef.add(post);

    res.json({ message: "Post created successfully" });
  } catch (error) {
    console.error("Error in create-post route:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.post("/like-post", async (req, res) => {
  const postId = req.query.postid;
  const uid = req.query.uid;
  try {
    await admin.firestore().runTransaction(async (transaction) => {
      const postRef = admin.firestore().collection("approvedPosts").doc(postId);
      const doc = await transaction.get(postRef);

      if (doc && doc.data && typeof doc.data === "function") {
        const likesCount = doc.data()?.likesCount || 0;
        // Use likesCount here...
        const postSnapshot = await postRef.get();
        const postData = postSnapshot.data();

        // Check if the user already liked the post
        if (
          postData &&
          postData.likedBy &&
          postData.likedBy.likes &&
          postData.likedBy.likes[uid]
        ) {
          console.log("User already liked this post");
          // Send an error response
          return res
            .status(200)
            .json({ message: "User already liked this post" });
        } else {
          try {
            // If the user hasn't liked the post yet, update the document
            await transaction.update(postRef, {
              [`likedBy.likes.${uid}` || `likedBy.likes.admin`]: true,
              likesCount: likesCount + 1, // Increment the like count
            });
            // Send a success response
            return res.json({ message: "Post liked successfully" });
          } catch (error) {
            console.log("Error liking post:", error);
            // Send an error response
            return res.status(500).json({ error: "Internal Server Error" });
          }
        }
      } else {
        console.error("Invalid document or missing data.");
        // Handle the case where doc is undefined or doesn't have a data() method
      }
    });
  } catch (e) {
    console.log(e);
  }
});
app.post("/dislike-post", async (req, res) => {
  try {
    const postId = req.query.postid;
    const uid = req.query.uid;

    // Update the like status for the user in the post document
    await admin.firestore().runTransaction(async (transaction) => {
      const postRef = admin.firestore().collection("approvedPosts").doc(postId);
      const doc = await transaction.get(postRef);
      const likesCount = doc.data().likesCount || 0;

      // Remove the like for the user from the post document
      await transaction.update(postRef, {
        [`likedBy.likes.${uid}`]: admin.firestore.FieldValue.delete(),
        likesCount: Math.max(likesCount - 1, 0), // Decrement the like count
      });
    });

    res.json({ message: "Post disliked successfully" });
  } catch (error) {
    console.error("Error disliking post:", error);
    res.status(500).json({ error: "Internal Server Error" });
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



app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});