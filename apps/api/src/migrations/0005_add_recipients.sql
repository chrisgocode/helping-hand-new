PRAGMA defer_foreign_keys = TRUE;

ALTER TABLE "user"
    ADD COLUMN accountKind TEXT NOT NULL DEFAULT 'caretaker'
        CHECK (accountKind IN ('caretaker', 'recipient'));

CREATE TABLE recipient (
    id TEXT PRIMARY KEY,

    userId TEXT NOT NULL UNIQUE
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    caretakerId TEXT NOT NULL
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    displayName TEXT NOT NULL
        CHECK (
            length(displayName) BETWEEN 1 AND 100
            AND displayName = trim(displayName)
        ),

    isActive INTEGER NOT NULL DEFAULT 1
        CHECK (isActive IN (0, 1)),

    activeSessionId TEXT,

    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CHECK (userId <> caretakerId),

    UNIQUE (id, caretakerId)
);

CREATE INDEX recipient_caretakerId_createdAt_idx
    ON recipient(caretakerId, createdAt);

CREATE TABLE task_assignment (
    recipientId TEXT NOT NULL,

    rootTaskId TEXT NOT NULL,

    caretakerId TEXT NOT NULL
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    PRIMARY KEY (recipientId, rootTaskId),

    FOREIGN KEY (recipientId, caretakerId)
        REFERENCES recipient(id, caretakerId)
        ON DELETE CASCADE,

    FOREIGN KEY (rootTaskId, caretakerId)
        REFERENCES task(id, userId)
        ON DELETE CASCADE
);

CREATE INDEX task_assignment_rootTaskId_idx
    ON task_assignment(rootTaskId);

-- Foreign keys cannot express "the assigned task has no parent", so the
-- root-only rule the service enforces is also enforced here.
CREATE TRIGGER task_assignment_root_only_insert
    BEFORE INSERT ON task_assignment
    FOR EACH ROW
    WHEN (SELECT parentId FROM task WHERE id = NEW.rootTaskId) IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'Only a root task can be assigned');
END;

CREATE TRIGGER task_assignment_root_only_update
    BEFORE UPDATE OF rootTaskId ON task_assignment
    FOR EACH ROW
    WHEN (SELECT parentId FROM task WHERE id = NEW.rootTaskId) IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'Only a root task can be assigned');
END;

CREATE TABLE enrollment (
    id TEXT PRIMARY KEY,

    recipientId TEXT NOT NULL
        REFERENCES recipient(id)
        ON DELETE CASCADE,

    caretakerId TEXT NOT NULL
        REFERENCES "user"(id)
        ON DELETE CASCADE,

    qrSecretHash TEXT NOT NULL,

    claimantSecretHash TEXT,

    matchingCode TEXT,

    state TEXT NOT NULL
        CHECK (state IN ('issued', 'claimed', 'approved', 'delivered', 'cancelled', 'expired')),

    expiresAt TEXT NOT NULL,

    deliveryExpiresAt TEXT,

    approvedSessionId TEXT,

    approvedSessionToken TEXT,

    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX enrollment_open_recipientId_uidx
    ON enrollment(recipientId)
    WHERE state IN ('issued', 'claimed', 'approved');

CREATE INDEX enrollment_recipientId_createdAt_idx
    ON enrollment(recipientId, createdAt);

CREATE INDEX enrollment_expiresAt_idx
    ON enrollment(expiresAt);
