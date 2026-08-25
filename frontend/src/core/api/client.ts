/** Unified API export module re-exporting API methods and types. */

export type { VerificationMode } from '../projection/projectionStore';

export { API_BASE_URL, WS_BASE_URL, ApiError, shareableApiBase, uploadToPresignedUrl, isTrustedApiBaseUrl, pinTrustedApiOrigin } from './http';

export type { ServerConfig } from './config';
export { getServerConfig } from './config';

export type { AdminSession } from './admin';
export { adminAuth, startAdminSession, resumeAdminSession, endAdminSession } from './admin';

export type {
  ApiWaypoint,
  ApiRoad,
  RubricDetail,
  ApiChallenge,
  ApiPowerup,
  ApiBoard,
  BoardPreviewPoint,
  BoardPreview,
  BoardSummary
} from './board';
export {
  createBoard,
  updateBoard,
  getBoard,
  listBoards,
  listBoardsByIds,
  listBoardsAdmin,
  setBoardVisibility,
  deleteBoardAdmin,
  forkBoard,
  validateBoard,
  publishBoard,
  addChallenge,
  setRoadblockDeck,
  setCurseDeck
} from './board';

export type {
  HostedMode,
  SoloMode,
  SoloVerificationMode,
  SoloRunCreated,
  LobbyPlayer,
  LobbyTeam,
  GameSummary,
  RaceCodeLookup,
  HostTeamSummary,
  JoinResult,
  Membership
} from './game';
export {
  createGame,
  createSoloRun,
  getGame,
  getGameByCode,
  startGame,
  endGame,
  listTeams,
  joinGame,
  joinExistingTeam,
  updateMembership,
  updateTeam,
  disbandTeam
} from './game';

export type { ChallengeDrawResult, SubmissionStatus } from './play';
export {
  startChallenge,
  presignUpload,
  submitChallengeEvidence,
  vetoChallenge,
  arriveWaypoint,
  buyPowerup,
  activatePowerup,
  clearRoadblock,
  resolveCurse,
  reportPosition,
  raiseDispute
} from './play';

export type { PendingReviewItem } from './host';
export {
  resolveDispute,
  listPendingReview,
  submitHostVerdict,
  overrideCoins,
  overrideClearChallenge,
  overrideClearEffect
} from './host';

export type { ReportEvidence, ReportStats, RaceReport } from './report';
export { getRaceReport, deleteRace, deleteMyEvidence } from './report';

export type { LeaderboardEntry } from './leaderboard';
export { postLeaderboardTime, getBoardLeaderboard } from './leaderboard';

export type { ApiRoadmapItem } from './roadmap';
export {
  listRoadmapItems,
  createRoadmapItem,
  updateRoadmapItem,
  deleteRoadmapItem,
  voteRoadmapItem,
  unvoteRoadmapItem,
  flagRoadmapItem
} from './roadmap';

export type { BugSeverity, BugStatus, BugReportContext, ApiBugReport } from './bugreports';
export {
  createBugReport,
  listBugReports,
  updateBugReportStatus,
  deleteBugReport
} from './bugreports';
