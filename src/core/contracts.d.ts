/** Structural v1 records shared with future clients. See INTEGRATION.md.
 * Declarations do not implement cloud APIs; normalize/validate all input. */
export type IsoInstant = string;
export type Id = string;
export type EvidenceKind = "browser" | "reading" | "media" | "background-media";
export interface ActivitySegment {
  startAt: IsoInstant; endAt: IsoInstant; host: string;
  resource: string; title: string; kind: EvidenceKind;
  uncertain: boolean; reasons: string[];
}
export interface ActivityAssignment {
  taskId: Id | null; projectId: Id | null; tagIds: Id[]; blockId: Id | null;
  source: "unknown" | "manual" | "rule" | "local" | "ai";
  reasons: string[]; note: string;
}
export interface ActivitySession {
  id: Id; revision: number; startAt: IsoInstant; endAt: IsoInstant;
  segments: ActivitySegment[]; assignment: ActivityAssignment;
  suggestions: ActivityAssignment[]; locked: boolean; excluded: boolean;
  confirmed: boolean; closed: boolean; reviewStartAt: IsoInstant | null;
  reviewEndAt: IsoInstant | null; aiFingerprint: string;
}
export interface ActivitySettings {
  enabled: boolean; details: boolean; aiEnabled: boolean; adaptiveReading: boolean;
  backgroundMedia: boolean; readingMinutes: number; reviewAfter: number;
  signalOrigins: string[];
}
export interface ActivityStore {
  version: 1; revision: number; settings: ActivitySettings;
  projects: Array<{id: Id; name: string}>; tags: Array<{id: Id; name: string}>;
  rules: Array<{id: Id; scope: "host" | "resource"; match: string; assignment: ActivityAssignment}>;
  sessions: ActivitySession[];
  cursor: null | {at: number; session: string; sessionId: Id; sample: Omit<ActivitySegment,"startAt" | "endAt">};
  gaps: Array<{startAt: IsoInstant; endAt: IsoInstant; reason: string}>;
  readingUntil: IsoInstant | null; idleSince: number | null;
  quota: {date: string; attempts: number; lastAt: number};
  undo: Array<{id: Id; at: IsoInstant; before: ActivitySession[]; after: Array<{id: Id; revision: number}>}>;
  lastError: string;
}
export interface ReminderSettings {
  enabled: boolean; blocks: boolean; deadlines: boolean; phases: boolean; review: boolean;
  leadMinutes: number; deadlineMinutes: number; quietStart: string; quietEnd: string;
}
export interface ReminderEvent {
  id: string; at: number; expires: number; title: string; message: string;
  view: "plan" | "today" | "activity"; taskId?: Id; blockId?: Id;
}
export interface ScheduledBlock {
  id: Id; taskId: Id; label: string; startAt: IsoInstant; endAt: IsoInstant;
  status: "planned" | "active" | "done" | "skipped";
  source: "manual" | "capture" | "proposal"; proposalId: Id | null; createdAt: IsoInstant;
}
export interface RecoveryChoice {taskId: Id; remainingMinutes: number}
export interface RecoveryProposal {
  id: Id; createdAt: IsoInstant; fingerprint: string; status: "pending";
  blocks: ScheduledBlock[]; replaced: ScheduledBlock[];
  remaining: Array<{taskId: Id; minutes: number}>;
  unscheduled: Array<{taskId: Id; reason: string}>;
}
export interface RecoveryHistory {
  id: Id; at: IsoInstant; before: ScheduledBlock[]; added: ScheduledBlock[];
  afterFingerprint: string;
}

/** Device-local app policy; a future backend must make reservations transactional. */
export interface AIPolicy {
  version: 1;
  automaticEnabled: boolean;
  dailyLimit: number; // integer 0..100
  day: string; // device-local YYYY-MM-DD; supply the user's timezone on a server
  used: number;
  byFeature: Record<"sorting" | "activity" | "memory", number>;
  epoch: number; // invalidates automatic responses when mode changes
}
export interface LearningGuide {
  version: 2;
  enabled: boolean; // invitation preference, never feature consent
  steps: Record<string, "done" | "skipped">; // packaged identifiers only
  pausedTopics: string[];
}
export interface MediaPreset {
  name: string;
  origin: string;
  kind: string;
  // A catalogue entry carries no enabled state or permission grant.
}
