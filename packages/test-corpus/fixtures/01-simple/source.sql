-- Minimal users table fixture.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT
);

INSERT INTO users (id, name, email) VALUES
  (1, 'Alice', 'alice@example.com'),
  (2, 'Bob',   NULL),
  (3, 'Carol', 'carol@example.com');
