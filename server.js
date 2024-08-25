const express = require("express");
const { db } = require("./firebaseAdmin");

const app = express();

app.get("/", (req, res) => {
  res.send("connected");
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
