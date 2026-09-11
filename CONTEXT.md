# Helping Hand

Helping Hand organizes work into recursive task trees that can be prepared in advance and followed one action at a time.

## Language

**Task**:
A repeatable node in a task tree with no permanent completion state. A task is either an actionable task or a summary task.

**Root task**:
A task with no parent that starts a task tree.
_Avoid_: Self-parented task

**Actionable task**:
A task with no children that represents work the user can perform directly.
_Avoid_: Leaf, step

**Summary task**:
A task with children that groups work rather than representing a separate action. Its duration is the sum of its descendant actionable-task durations only when every descendant has a duration; otherwise, its duration is unknown.
_Avoid_: Parent duration, independently estimated parent

**Task duration**:
An approximate total elapsed time for completing an actionable task, including waiting. One value supplies both the displayed estimate and the wearable timer. It is generated only when explicitly requested for a selected task subtree, remains editable, and is guidance rather than a deadline or measure of productivity. Generation fills only missing durations and preserves existing values.
_Avoid_: Separate timer and estimate, time limit, target time, performance metric

**Order optimization**:
A proposed reordering of a summary task's immediate children so prerequisites precede dependent work. Each child moves with all of its descendants while keeping the same parent. Order optimization does not use duration as priority.
_Avoid_: Prioritization, fastest-first sorting

**Task deletion**:
Removal of a task and all of its descendants from a task tree.
_Avoid_: Orphaning descendants

**Task breakdown**:
A proposed set of immediate children for an actionable task. Accepting the proposal turns the actionable task into a summary task; deeper breakdown requires another explicit request on one of its actionable children.
_Avoid_: Re-breaking down a summary task

**AI proposal**:
A specific AI-generated change that is applied to the local task-tree draft after the user requests it. It does not change the saved task tree until the user saves the draft.
_Avoid_: Automatically persisted AI change, replacement task tree

**Guided session**:
A temporary traversal of a task tree that shows one actionable task at a time. Ending the session clears its current position and does not change the saved task tree.
_Avoid_: Permanent progress, task completion

## Recipient access

**Caretaker**:
A person who signs in with their own credentials, builds task trees, and manages recipients. Every caretaker account owns its recipients, task trees, and categories.
_Avoid_: Carer, owner, admin, parent account

**Recipient**:
A person who follows assigned task trees on their own device and never edits them. A recipient belongs to exactly one caretaker and has a credential-free identity that only a caretaker can create.
_Avoid_: Patient, client, child account, sub-user

**Task assignment**:
A caretaker's grant of one root task, and therefore its complete task tree, to one recipient. The same task tree can be assigned to several recipients, and editing it changes what every assigned recipient sees.
_Avoid_: Share, publish, permission grant

**Enrollment**:
The one-time exchange that signs a recipient's device in: the caretaker displays a QR code, the device claims it, both screens show the same confirmation code, and the caretaker approves.
_Avoid_: Pairing, registration, invitation, login link

**Matching code**:
The short code shown on both devices during an enrollment so the caretaker can confirm they are approving the device in front of them. It confirms; it never authenticates.
_Avoid_: PIN, OTP, verification code

**Device replacement**:
A new enrollment for a recipient who already has a device. Approving it revokes the previous device and preserves the recipient profile and its assignments.
_Avoid_: Re-pairing, transfer, migration

**Access revocation**:
A caretaker ending a recipient device's access, either explicitly or by disabling the recipient. Assignments survive, and re-enabling a recipient alone does not restore the old device.
_Avoid_: Unpair, ban, delete recipient
