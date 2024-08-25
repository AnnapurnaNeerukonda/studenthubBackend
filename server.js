const PORT = process.env.PORT || 4000;
const express = require('express');
const app = express();
const admin = require('firebase-admin');
const bcrypt = require('bcrypt');
const cors = require('cors');
const jwt = require('jsonwebtoken');  // Import the jsonwebtoken library
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
