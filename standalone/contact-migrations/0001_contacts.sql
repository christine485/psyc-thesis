-- Keep draw contact details in a separate database from research answers.
-- Retain original pilot/phones/, pilot/permits/, live/phones/ and live/permits/ keys.
CREATE TABLE contact_objects (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
