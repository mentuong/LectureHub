const express = require('express');
const router = express.Router();
const Lecture = require('../models/lecture');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Create lecture
router.post('/', authenticateToken, async (req, res) => {
  const { title, description, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ message: 'Title and content are required.' });
  }
  try {
    const lecture = new Lecture({
      user: req.user.id,
      title,
      description,
      content
    });
    await lecture.save();
    res.status(201).json(lecture);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create lecture.', error: err.message });
  }
});

// Get all lectures of logged-in user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const lectures = await Lecture.find({ user: req.user.id }).sort({ updatedAt: -1 });
    res.json(lectures);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch lectures.', error: err.message });
  }
});

// Get single lecture by id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const lecture = await Lecture.findOne({ _id: req.params.id, user: req.user.id });
    if (!lecture) return res.status(404).json({ message: 'Lecture not found.' });
    res.json(lecture);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch lecture.', error: err.message });
  }
});

// Update lecture
router.put('/:id', authenticateToken, async (req, res) => {
  const { title, description, content } = req.body;
  try {
    const lecture = await Lecture.findOne({ _id: req.params.id, user: req.user.id });
    if (!lecture) return res.status(404).json({ message: 'Lecture not found.' });
    if (title) lecture.title = title;
    if (description) lecture.description = description;
    if (content) lecture.content = content;
    await lecture.save();
    res.json(lecture);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update lecture.', error: err.message });
  }
});

// Delete lecture
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const lecture = await Lecture.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!lecture) return res.status(404).json({ message: 'Lecture not found.' });
    res.json({ message: 'Lecture deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete lecture.', error: err.message });
  }
});

module.exports = router;
