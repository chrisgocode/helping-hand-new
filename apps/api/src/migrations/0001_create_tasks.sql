CREATE TABLE task (
    id TEXT PRIMARY KEY,

    userId TEXT NOT NULL
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    parentId TEXT,

    title TEXT NOT NULL,

    position INTEGER NOT NULL DEFAULT 0
        CHECK (position >= 0),

    source TEXT NOT NULL DEFAULT 'manual'
        CHECK (
            source IN (
                'manual',
                'ai'
            )
        ),

    timerSeconds INTEGER
        CHECK (
            timerSeconds IS NULL
            OR timerSeconds >= 0
        ),

    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (parentId IS NULL OR parentId <> id),

    UNIQUE (id, userId),

    FOREIGN KEY (parentId, userId)
        REFERENCES task(id, userId)
        ON DELETE CASCADE
);

CREATE INDEX task_parentId_position_idx
    ON task(parentId, position);

CREATE INDEX task_userId_parentId_position_idx
    ON task(userId, parentId, position);
