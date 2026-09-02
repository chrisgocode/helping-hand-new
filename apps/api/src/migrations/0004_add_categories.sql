PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE category (
    id TEXT PRIMARY KEY,

    userId TEXT NOT NULL
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    name TEXT NOT NULL COLLATE NOCASE
        CHECK (
            length(name) BETWEEN 1 AND 100
            AND name = trim(name)
        ),

    position INTEGER NOT NULL
        CHECK (position >= 0),

    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    UNIQUE (userId, name)
);

CREATE TABLE task_new (
    id TEXT PRIMARY KEY,

    userId TEXT NOT NULL
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    parentId TEXT,

    categoryId TEXT
        REFERENCES category(id)
        ON DELETE SET NULL,

    title TEXT NOT NULL,

    position INTEGER NOT NULL DEFAULT 0
        CHECK (position >= 0),

    durationSeconds INTEGER
        CHECK (
            durationSeconds IS NULL
            OR durationSeconds >= 0
        ),

    revision INTEGER NOT NULL DEFAULT 0
        CHECK (revision >= 0),

    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (parentId IS NULL OR parentId <> id),
    CHECK (parentId IS NULL OR categoryId IS NULL),

    UNIQUE (id, userId),

    FOREIGN KEY (parentId, userId)
        REFERENCES task_new(id, userId)
        ON DELETE CASCADE
);

INSERT INTO task_new (
    id,
    userId,
    parentId,
    categoryId,
    title,
    position,
    durationSeconds,
    revision,
    createdAt,
    updatedAt
)
SELECT
    id,
    userId,
    parentId,
    NULL,
    title,
    position,
    durationSeconds,
    revision,
    createdAt,
    updatedAt
FROM task;

DROP TABLE task;

ALTER TABLE task_new RENAME TO task;

CREATE INDEX task_parentId_position_idx
    ON task(parentId, position);

CREATE INDEX task_userId_parentId_position_idx
    ON task(userId, parentId, position);

CREATE INDEX task_userId_createdAt_idx
    ON task(userId, createdAt DESC);

CREATE INDEX category_userId_position_idx
    ON category(userId, position);
