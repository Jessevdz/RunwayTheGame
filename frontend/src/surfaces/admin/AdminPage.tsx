import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { PageShell } from '../shared/PageShell';
import { PageFooter } from '../shared/PageFooter';
import {
  Button,
  IconButton,
  BrandLines,
  Notice,
  Badge,
  Empty,
  Input,
  Dialog,
  Tabs,
  Card,
  IconSignOut
} from '@ds';
import { RoadmapLane } from '../roadmap/components/RoadmapLane';
import { CreateItemDialog } from '../roadmap/components/CreateItemDialog';
import { EditItemDialog } from '../roadmap/components/EditItemDialog';
import { RoutePreview } from '../../core/map/RoutePreview';
import { boardTitle } from '../shared/boardFilters';
import {
  listRoadmapItems,
  createRoadmapItem,
  updateRoadmapItem,
  deleteRoadmapItem,
  voteRoadmapItem,
  unvoteRoadmapItem,
  flagRoadmapItem,
  listBoardsAdmin,
  setBoardVisibility,
  deleteBoardAdmin,
  startAdminSession,
  resumeAdminSession,
  endAdminSession,
  listBugReports,
  updateBugReportStatus,
  deleteBugReport
} from '../../core/api/client';
import type {
  ApiRoadmapItem,
  BoardSummary,
  ApiBugReport,
  BugStatus
} from '../../core/api/client';
import { getOrCreateVoterId } from '../../core/game/voterSession';
import { formatReportContext } from '../../core/diagnostics/reportContext';

/** User-facing notice outcome for administrative operations. */
interface ActionNotice {
  text: string;
  kind: 'info' | 'stop';
}

type BoardFilter = 'all' | 'listed' | 'unlisted';

type AdminTab = 'roadmap' | 'gallery' | 'bugs';

/** Tone for a bug report's severity chip. */
const SEVERITY_TONE: Record<string, 'crimson' | 'gold' | 'neutral'> = {
  BLOCKER: 'crimson',
  NORMAL: 'gold',
  COSMETIC: 'neutral'
};

/** The order a triager moves a report through. */
const BUG_STATUSES: BugStatus[] = ['NEW', 'TRIAGED', 'FIXED', 'WONTFIX'];

/** Returns true if a board is listed in the gallery. */
const isBoardListed = (board: BoardSummary): boolean => board.is_listed !== false;

export const AdminPage: React.FC = () => {
  const voterId = getOrCreateVoterId();
  const navigate = useNavigate();
  // A key in the path or the query is a key in somebody's proxy log. Links
  // written before sessions existed still work — the key is spent for a session
  // on arrival and scrubbed from the address bar — but nothing mints one now.
  const { adminKey: legacyRouteKey } = useParams<{ adminKey?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const legacyQueryKey = searchParams.get('admin_key') || searchParams.get('key');
  const tabParam = searchParams.get('tab');
  const initialTab: AdminTab =
    tabParam === 'gallery' ? 'gallery' : tabParam === 'bugs' ? 'bugs' : 'roadmap';

  const [enteredKey, setEnteredKey] = useState<string>('');
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);

  const [isVerifying, setIsVerifying] = useState<boolean>(true);
  const [isKeyValid, setIsKeyValid] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Roadmap state
  const [roadmapItems, setRoadmapItems] = useState<ApiRoadmapItem[]>([]);
  const [loadingRoadmap, setLoadingRoadmap] = useState<boolean>(false);
  const [roadmapError, setRoadmapError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<ApiRoadmapItem | null>(null);

  // Gallery state
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loadingBoards, setLoadingBoards] = useState<boolean>(false);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [deletingBoard, setDeletingBoard] = useState<BoardSummary | null>(null);
  const [togglingVisibilityId, setTogglingVisibilityId] = useState<string | null>(null);

  // Bug report state
  const [bugReports, setBugReports] = useState<ApiBugReport[]>([]);
  const [loadingBugs, setLoadingBugs] = useState<boolean>(false);
  const [bugsError, setBugsError] = useState<string | null>(null);
  const [expandedBugId, setExpandedBugId] = useState<string | null>(null);

  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const reportOk = (text: string) => setActionNotice({ text, kind: 'info' });
  const reportFail = (text: string) => setActionNotice({ text, kind: 'stop' });

  // Updates the URL active tab parameter.
  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  };

  // Stores initial legacy key for session authentication.
  const legacyKeyRef = useRef<string | undefined>(legacyRouteKey || legacyQueryKey || undefined);

  /** Removes legacy admin key query parameters from the address bar. */
  const scrubLegacyKey = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    next.delete('admin_key');
    next.delete('key');
    const query = next.toString();
    navigate({ pathname: '/admin', search: query ? `?${query}` : '' }, { replace: true });
  }, [navigate]);

  // Initializes admin session from legacy URL key or browser cookie on load.
  useEffect(() => {
    let cancelled = false;
    const legacyKey = legacyKeyRef.current;

    (async () => {
      try {
        if (legacyKey) {
          await startAdminSession(legacyKey);
        } else if (!(await resumeAdminSession())) {
          if (!cancelled) setIsKeyValid(false);
          return;
        }
        if (!cancelled) setIsKeyValid(true);
      } catch (err: any) {
        if (!cancelled) {
          setIsKeyValid(false);
          setAuthError(err?.message || 'Invalid or expired admin key.');
        }
      } finally {
        if (!cancelled) setIsVerifying(false);
        if (legacyKey) scrubLegacyKey();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scrubLegacyKey]);

  const fetchRoadmap = useCallback(async () => {
    if (!isKeyValid) return;
    setLoadingRoadmap(true);
    setRoadmapError(null);
    try {
      const data = await listRoadmapItems(voterId, true);
      setRoadmapItems(data);
    } catch (err: any) {
      setRoadmapError(err.message || 'Failed to load roadmap items');
    } finally {
      setLoadingRoadmap(false);
    }
  }, [isKeyValid, voterId]);

  const fetchGallery = useCallback(async () => {
    if (!isKeyValid) return;
    setLoadingBoards(true);
    setBoardsError(null);
    try {
      const list = await listBoardsAdmin();
      setBoards(list);
    } catch (err: any) {
      setBoardsError(err.message || 'Failed to load gallery maps');
    } finally {
      setLoadingBoards(false);
    }
  }, [isKeyValid]);

  const fetchBugs = useCallback(async () => {
    if (!isKeyValid) return;
    setLoadingBugs(true);
    setBugsError(null);
    try {
      setBugReports(await listBugReports());
    } catch (err: any) {
      setBugsError(err.message || 'Failed to load bug reports');
    } finally {
      setLoadingBugs(false);
    }
  }, [isKeyValid]);

  useEffect(() => {
    if (isKeyValid) {
      fetchRoadmap();
      fetchGallery();
      fetchBugs();
    }
  }, [isKeyValid, fetchRoadmap, fetchGallery, fetchBugs]);

  const handleBugStatus = async (id: string, status: BugStatus) => {
    if (!isKeyValid) return;
    try {
      const updated = await updateBugReportStatus(id, status);
      setBugReports((prev) => prev.map((b) => (b.id === id ? updated : b)));
      reportOk(`Report moved to ${status}.`);
    } catch (err: any) {
      reportFail(err.message || 'Failed to update the report');
    }
  };

  const handleBugDelete = async (id: string) => {
    if (!isKeyValid) return;
    try {
      await deleteBugReport(id);
      setBugReports((prev) => prev.filter((b) => b.id !== id));
      reportOk('Report deleted.');
    } catch (err: any) {
      reportFail(err.message || 'Failed to delete the report');
    }
  };

  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = enteredKey.trim();
    if (!trimmed || isVerifying) return;

    setIsVerifying(true);
    setAuthError(null);
    try {
      await startAdminSession(trimmed);
      // The key bought a session; the console has no further use for it.
      setEnteredKey('');
      setIsKeyValid(true);
    } catch (err: any) {
      setAuthError(err?.message || 'Invalid admin key.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSignOut = async () => {
    await endAdminSession();
    setIsKeyValid(false);
    setAuthError(null);
  };

  // Roadmap Actions
  const handleVote = async (id: string, currentlyVoted: boolean) => {
    setRoadmapItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const delta = currentlyVoted ? -1 : 1;
          return {
            ...item,
            voted: !currentlyVoted,
            vote_count: Math.max(0, item.vote_count + delta)
          };
        }
        return item;
      })
    );

    try {
      if (currentlyVoted) {
        await unvoteRoadmapItem(id, voterId);
      } else {
        await voteRoadmapItem(id, voterId);
      }
    } catch (err: any) {
      reportFail(`Failed to update vote: ${err.message || 'Unknown error'}`);
      fetchRoadmap();
    }
  };

  const handleFlag = async (id: string) => {
    try {
      await flagRoadmapItem(id, voterId);
      reportOk('Item reported.');
      fetchRoadmap();
    } catch (err: any) {
      reportFail(`Failed to report item: ${err.message || 'Unknown error'}`);
    }
  };

  const handleCreateSubmit = async (data: { title: string; description: string }) => {
    const newItem = await createRoadmapItem(data);
    setRoadmapItems((prev) => [newItem, ...prev]);
    reportOk('Idea submitted successfully!');
  };

  const handleMoveStatus = async (id: string, newStatus: ApiRoadmapItem['status']) => {
    if (!isKeyValid) return;
    try {
      const updated = await updateRoadmapItem(id, { status: newStatus });
      setRoadmapItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
      reportOk(`Moved item to lane "${newStatus.replace('_', ' ')}"`);
    } catch (err: any) {
      reportFail(`Failed to move feature: ${err.message || 'Unknown error'}`);
    }
  };

  const handleEditSubmit = async (
    id: string,
    data: { title: string; description: string; status: ApiRoadmapItem['status'] }
  ) => {
    if (!isKeyValid) return;
    const updated = await updateRoadmapItem(id, data);
    setRoadmapItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    reportOk('Roadmap item updated successfully.');
  };

  const handleDeleteRoadmap = async (id: string) => {
    if (!isKeyValid) return;
    try {
      await deleteRoadmapItem(id);
      setRoadmapItems((prev) => prev.filter((item) => item.id !== id));
      reportOk('Roadmap item removed.');
    } catch (err: any) {
      reportFail(`Failed to remove feature: ${err.message || 'Unknown error'}`);
    }
  };

  // Gallery Actions
  const handleToggleBoardVisibility = async (board: BoardSummary) => {
    if (!isKeyValid) return;
    const newStatus = !isBoardListed(board);
    setTogglingVisibilityId(board.id);
    try {
      await setBoardVisibility(board.id, newStatus, { asAdmin: true });
      setBoards((prev) =>
        prev.map((b) => (b.id === board.id ? { ...b, is_listed: newStatus } : b))
      );
      reportOk(
        `Map "${boardTitle(board)}" is now ${newStatus ? 'published in the gallery' : 'unlisted'}.`
      );
    } catch (err: any) {
      reportFail(`Failed to update map visibility: ${err.message || 'Unknown error'}`);
    } finally {
      setTogglingVisibilityId(null);
    }
  };

  const handleConfirmDeleteBoard = async () => {
    if (!isKeyValid || !deletingBoard) return;
    try {
      await deleteBoardAdmin(deletingBoard.id);
      setBoards((prev) => prev.filter((b) => b.id !== deletingBoard.id));
      reportOk(`Map "${boardTitle(deletingBoard)}" was permanently removed.`);
    } catch (err: any) {
      reportFail(`Failed to delete map: ${err.message || 'Unknown error'}`);
    } finally {
      setDeletingBoard(null);
    }
  };

  const handleViewBoard = (id: string) => {
    navigate(`/design/${id}`);
  };

  // Render Key Prompt if unauthenticated or verifying
  if (!isKeyValid) {
    return (
      <PageShell
        navPlacement="topbar"
        topBarProps={{
          title: (
            <div className="admin-brand-header">
              <BrandLines size={24} />
              <span className="t-announce fs-7 admin-brand-title">
                RUNWAY ADMIN
              </span>
            </div>
          )
        }}
        loading={isVerifying}
      >
        <section className="admin-auth-section">
          <Card className="card--pad admin-auth-card">
            <h1 className="t-announce fs-d-md admin-auth-title">
              Admin Console Access
            </h1>

            {authError && (
              <div className="admin-mb-4">
                <Notice kind="stop">{authError}</Notice>
              </div>
            )}

            <form onSubmit={handleKeySubmit} className="admin-auth-form">
              <Input
                label="Admin Secret Key"
                type="password"
                placeholder="Enter admin secret key"
                value={enteredKey}
                onChange={(e) => setEnteredKey(e.target.value)}
              />
              <Button variant="primary" size="lg" disabled={!enteredKey.trim() || isVerifying} onClick={handleKeySubmit}>
                {isVerifying ? 'Verifying...' : 'Unlock Admin Console'}
              </Button>
            </form>
          </Card>
        </section>
        <PageFooter />
      </PageShell>
    );
  }

  // Filtered Gallery Boards
  const query = searchQuery.trim().toLowerCase();
  const filteredBoards = boards.filter((b) => {
    const matchesSearch =
      query === '' || boardTitle(b).toLowerCase().includes(query) || b.id.toLowerCase().includes(query);
    if (!matchesSearch) return false;
    if (boardFilter === 'listed') return isBoardListed(b);
    if (boardFilter === 'unlisted') return !isBoardListed(b);
    return true;
  });

  const proposedItems = roadmapItems.filter((i) => i.status === 'PROPOSED');
  const plannedItems = roadmapItems.filter((i) => i.status === 'PLANNED');
  const inProgressItems = roadmapItems.filter((i) => i.status === 'IN_PROGRESS');
  const shippedItems = roadmapItems.filter((i) => i.status === 'SHIPPED');

  const listedCount = boards.filter(isBoardListed).length;
  const unlistedCount = boards.length - listedCount;

  const newBugCount = bugReports.filter((b) => b.status === 'NEW').length;

  return (
    <PageShell
      navPlacement="topbar"
      topBarProps={{
        title: (
          <div className="admin-brand-header">
            <BrandLines size={24} />
            <span className="t-announce fs-7 admin-brand-title">
              RUNWAY ADMIN PORTAL
            </span>
          </div>
        )
      }}
      loading={loadingRoadmap || loadingBoards}
      error={roadmapError || boardsError}
      onRetry={() => {
        fetchRoadmap();
        fetchGallery();
      }}
    >
      <section className="admin-main-section">
        {/* Portal Header */}
        <div className="admin-header">
          <div className="admin-header__actions">
            <Button variant="ghost" size="sm" icon={<IconSignOut />} onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
          <h1 className="t-announce fs-d-md admin-header__title">
            Runway Admin Console
          </h1>
        </div>

        {/* Action Notice */}
        {actionNotice && (
          <div className="admin-mb-4">
            <Notice
              kind={actionNotice.kind}
              className="admin-notice-content"
            >
              <span>{actionNotice.text}</span>
              <IconButton
                icon="✕"
                label="Dismiss notice"
                size="sm"
                className="admin-notice-dismiss"
                onClick={() => setActionNotice(null)}
              />
            </Notice>
          </div>
        )}

        {/* Tab Selection */}
        <div className="admin-tabs-center">
          <Tabs
            items={[
              { id: 'roadmap', label: 'Roadmap', icon: '📋', badge: roadmapItems.length },
              { id: 'gallery', label: 'Gallery', icon: '🗺️', badge: boards.length },
              { id: 'bugs', label: 'Bugs', icon: '🐞', badge: newBugCount }
            ]}
            active={activeTab}
            onChange={(id) => handleTabChange(id as AdminTab)}
          />
        </div>

        {activeTab === 'roadmap' && (
          <div>
            <div className="admin-section-bar">
              <div>
                <p className="t-label fs-label">ROADMAP MANAGEMENT</p>
                <h2 className="t-announce fs-8 admin-text-muted">
                  Feature Lanes &amp; Suggestions
                </h2>
              </div>
              <Button variant="primary" icon="➕" onClick={() => setCreateDialogOpen(true)}>
                Create Feature Idea
              </Button>
            </div>

            <div className="admin-roadmap-grid">
              <RoadmapLane
                title="Proposed"
                laneKey="PROPOSED"
                badgeTone="neutral"
                items={proposedItems}
                onVote={handleVote}
                onFlag={handleFlag}
                onOpenSubmit={() => setCreateDialogOpen(true)}
                isAdmin={true}
                onMoveStatus={handleMoveStatus}
                onEdit={(item) => setEditingItem(item)}
                onDelete={handleDeleteRoadmap}
              />
              <RoadmapLane
                title="Planned"
                laneKey="PLANNED"
                badgeTone="gold"
                items={plannedItems}
                onVote={handleVote}
                onFlag={handleFlag}
                isAdmin={true}
                onMoveStatus={handleMoveStatus}
                onEdit={(item) => setEditingItem(item)}
                onDelete={handleDeleteRoadmap}
              />
              <RoadmapLane
                title="In Progress"
                laneKey="IN_PROGRESS"
                badgeTone="rust"
                items={inProgressItems}
                onVote={handleVote}
                onFlag={handleFlag}
                isAdmin={true}
                onMoveStatus={handleMoveStatus}
                onEdit={(item) => setEditingItem(item)}
                onDelete={handleDeleteRoadmap}
              />
              <RoadmapLane
                title="Shipped"
                laneKey="SHIPPED"
                badgeTone="moss"
                items={shippedItems}
                onVote={handleVote}
                onFlag={handleFlag}
                isAdmin={true}
                onMoveStatus={handleMoveStatus}
                onEdit={(item) => setEditingItem(item)}
                onDelete={handleDeleteRoadmap}
              />
            </div>
          </div>
        )}

        {activeTab === 'gallery' && (
          <div>
            <div className="admin-mb-4">
              <p className="t-label fs-label">GALLERY MODERATION</p>
              <h2 className="t-announce fs-8 admin-text-muted">
                Public &amp; Unlisted Maps
              </h2>
            </div>

            {/* Filter and Search Bar */}
            <div className="admin-filter-bar">
              <div className="admin-filter-search">
                <Input
                  placeholder="Search map name or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {/* The pill cannot wrap without breaking its shape, so on a narrow
                  screen it scrolls rather than running off the edge. */}
              <div className="admin-filter-tabs-wrapper">
                <Tabs
                  items={[
                    { id: 'all', label: 'All', badge: boards.length },
                    { id: 'listed', label: 'Published', badge: listedCount },
                    { id: 'unlisted', label: 'Unlisted', badge: unlistedCount }
                  ]}
                  active={boardFilter}
                  onChange={(id) => setBoardFilter(id as BoardFilter)}
                  className="admin-filter-tabs"
                />
              </div>
            </div>

            {filteredBoards.length === 0 ? (
              <Empty
                icon="🎯"
                title="No maps found"
                description="No maps matched your current filter or search criteria."
                action={
                  <Button variant="secondary" onClick={() => { setBoardFilter('all'); setSearchQuery(''); }}>
                    Clear Filters
                  </Button>
                }
              />
            ) : (
              <div className="admin-gallery-grid">
                {filteredBoards.map((board) => {
                  const isListed = isBoardListed(board);
                  const title = boardTitle(board);
                  return (
                    <Card
                      key={board.id}
                      className={`card--pad admin-board-card ${!isListed ? 'admin-board-card--unlisted' : ''}`}
                    >
                      <div className="admin-board-card__header">
                        <Badge tone={isListed ? 'moss' : 'rust'}>
                          {isListed ? 'PUBLISHED' : 'UNLISTED'}
                        </Badge>
                        <span className="t-data fs-2 admin-text-muted">
                          {new Date(board.updated_at).toLocaleDateString()}
                        </span>
                      </div>

                      <h3
                        className={`t-announce fs-7 admin-board-card__title ${isListed ? 'admin-board-card__title--listed' : 'admin-board-card__title--unlisted'}`}
                      >
                        {title}
                      </h3>

                      <RoutePreview preview={board.preview} label={`Route map for ${title}`} />

                      <div className="t-data fs-2 admin-board-card__meta">
                        <span>{board.waypoint_count} CP</span>
                        <span
                          className="admin-board-card__id"
                          title={board.id}
                        >
                          {board.id}
                        </span>
                      </div>

                      {/* Admin Controls for Map */}
                      <div className="admin-board-card__actions">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={togglingVisibilityId === board.id}
                          onClick={() => handleToggleBoardVisibility(board)}
                        >
                          {togglingVisibilityId === board.id
                            ? 'Updating...'
                            : isListed
                              ? 'Unlist / Hide'
                              : 'Publish / Relist'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleViewBoard(board.id)}>
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="admin-btn-delete"
                          onClick={() => setDeletingBoard(board)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'bugs' && (
          <div>
            <div className="admin-section-bar">
              <div>
                <p className="t-label fs-label">PLAYTEST REPORTS</p>
                <h2 className="t-announce fs-8 admin-text-muted">
                  What testers hit in the field
                </h2>
              </div>
              <Button variant="secondary" onClick={fetchBugs} disabled={loadingBugs}>
                {loadingBugs ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>

            {bugsError && <Notice kind="stop">{bugsError}</Notice>}

            {!loadingBugs && bugReports.length === 0 ? (
              <Empty
                icon="🐞"
                title="No bug reports"
                description="Reports filed by playtesters land here. Send a tester a link ending in ?playtest=1 to give them the report button."
              />
            ) : (
              <div className="admin-bug-list">
                {bugReports.map((report) => {
                  const expanded = expandedBugId === report.id;
                  return (
                    <Card key={report.id} className="card--pad admin-bug-card">
                      <div className="admin-bug-card__header">
                        <Badge tone={SEVERITY_TONE[report.severity] ?? 'neutral'}>
                          {report.severity}
                        </Badge>
                        <Badge tone={report.status === 'NEW' ? 'rust' : 'moss'}>
                          {report.status}
                        </Badge>
                        <span className="t-data fs-2 admin-text-muted">
                          {new Date(report.created_at).toLocaleString()}
                        </span>
                      </div>

                      <h3 className="t-announce fs-7 admin-bug-card__summary">
                        {report.summary}
                      </h3>

                      {report.details && (
                        <p className="fs-5 admin-bug-card__details">{report.details}</p>
                      )}

                      <div className="t-data fs-2 admin-bug-card__meta">
                        <span>{report.context.route || 'unknown page'}</span>
                        <span>{report.context.app_version}</span>
                        <span>{report.context.screen}</span>
                      </div>

                      <button
                        type="button"
                        className="admin-bug-card__toggle"
                        onClick={() => setExpandedBugId(expanded ? null : report.id)}
                        aria-expanded={expanded}
                      >
                        {expanded ? 'Hide' : 'Show'} diagnostics
                      </button>

                      {expanded && (
                        <pre className="admin-bug-card__pre">
                          {formatReportContext(report.context)}
                        </pre>
                      )}

                      <div className="admin-bug-card__actions">
                        {BUG_STATUSES.filter((st) => st !== report.status).map((st) => (
                          <Button
                            key={st}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleBugStatus(report.id, st)}
                          >
                            {st}
                          </Button>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="admin-btn-delete"
                          onClick={() => handleBugDelete(report.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Roadmap Dialogs */}
      <CreateItemDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreateSubmit}
      />

      <EditItemDialog
        open={Boolean(editingItem)}
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSubmit={handleEditSubmit}
      />

      {/* Delete Map Confirmation Dialog */}
      {deletingBoard && (
        <Dialog
          open={Boolean(deletingBoard)}
          onClose={() => setDeletingBoard(null)}
          title="Delete Gallery Map?"
        >
          <div className="admin-dialog-body">
            <p className="fs-5 admin-mb-4">
              Are you sure you want to permanently delete map{' '}
              <strong>&ldquo;{boardTitle(deletingBoard)}&rdquo;</strong>? This action cannot be undone.
            </p>
            <div className="admin-dialog-actions">
              <Button variant="ghost" onClick={() => setDeletingBoard(null)}>
                Cancel
              </Button>
              {/* The trigger is quiet; the confirmation is the emphatic one. */}
              <Button
                variant="primary"
                className="admin-btn-danger-confirm"
                onClick={handleConfirmDeleteBoard}
              >
                Delete Permanently
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      <PageFooter />
    </PageShell>
  );
};

