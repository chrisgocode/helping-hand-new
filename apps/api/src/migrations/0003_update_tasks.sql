PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE task_new (
    id TEXT PRIMARY KEY,

    userId TEXT NOT NULL
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    parentId TEXT,

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

    UNIQUE (id, userId),

    FOREIGN KEY (parentId, userId)
        REFERENCES task_new(id, userId)
        ON DELETE CASCADE
);

INSERT INTO task_new (
    id,
    userId,
    parentId,
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
    title,
    position,
    timerSeconds,
    0,
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
