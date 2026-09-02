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
