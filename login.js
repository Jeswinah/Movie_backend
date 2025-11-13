const express = require('express');
const router = express.Router();

const USERS = [
  { id: 1, username: 'jeswin', password: 'admin123' },
  { id: 2, username: 'admin', password: 'admin' },
];

router.post('/login', (req, res) => {
  try {
    console.log('Login request received:', req.body);
    const { username, password } = req.body;
    const user = USERS.find(u => u.username === username && u.password === password);
    
    if (user) {
      console.log('✅ Login successful for:', username);
      res.json({ message: "ok" });
    } else {
      console.log('❌ Invalid credentials for:', username);
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.log("Error:", error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;    