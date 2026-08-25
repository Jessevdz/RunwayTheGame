import React, { useCallback, useState } from 'react';
import { generateUUID } from '../../core/util/uuid';
import {
  parseCard,
  joinCard,
  DEFAULT_ROADBLOCKS,
  DEFAULT_CURSES,
  DECK_META
} from './deckCards';
import type { CardDraft, DeckKind } from './deckCards';
import { Dialog, Button, IconButton, Input, Textarea, Tabs, Empty } from '@ds';
import {
  IconDeck,
  IconDone,
  IconDuplicate,
  IconPlus,
  IconReset,
  IconTrash
} from './components/EditorIcons';

interface DeckWorkshopProps {
  initialDeck: DeckKind;
  roadblockCards: CardDraft[];
  curseCards: CardDraft[];
  isEditable: boolean;
  onChangeRoadblocks: (updated: CardDraft[]) => void;
  onChangeCurses: (updated: CardDraft[]) => void;
  onClose: () => void;
}

interface EditState {
  id: string;
  title: string;
  description: string;
}

const newCardId = (_deck: DeckKind) => generateUUID();

const DECK_BLURB: Record<DeckKind, string> = {
  roadblock:
    'Roadblocks are the challenges a team has to clear before it can move on. Start from the shipped set, or write your own.',
  curse:
    'Curses are constraints a team inflicts on its opponents. Start from the shipped set, or write your own.'
};

export const DeckWorkshop: React.FC<DeckWorkshopProps> = ({
  initialDeck,
  roadblockCards,
  curseCards,
  isEditable,
  onChangeRoadblocks,
  onChangeCurses,
  onClose
}) => {
  const [activeDeck, setActiveDeck] = useState<DeckKind>(initialDeck);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  const cards = activeDeck === 'roadblock' ? roadblockCards : curseCards;
  const onChange = activeDeck === 'roadblock' ? onChangeRoadblocks : onChangeCurses;
  const meta = DECK_META[activeDeck];

  /** Focuses the card's input field on mount. */
  const focusFirstField = useCallback((waypoint: HTMLDivElement | null) => {
    waypoint?.querySelector<HTMLInputElement>('.field__input')?.focus();
  }, []);

  const switchDeck = (kind: DeckKind) => {
    setActiveDeck(kind);
    setEditing(null);
    setConfirmingReplace(false);
  };

  const beginEdit = (card: CardDraft) => {
    if (!isEditable) return;
    setEditing({ id: card.id, ...parseCard(card.text) });
  };

  const commitEdit = (patch: Partial<Pick<EditState, 'title' | 'description'>>) => {
    if (!editing) return;
    const next = { ...editing, ...patch };
    setEditing(next);
    onChange(
      cards.map((c) => (c.id === next.id ? { ...c, text: joinCard(next.title, next.description) } : c))
    );
  };

  const handleAddCard = () => {
    const card: CardDraft = { id: newCardId(activeDeck), text: '' };
    onChange([...cards, card]);
    setEditing({ id: card.id, title: '', description: '' });
  };

  const handleDuplicate = (card: CardDraft) => {
    const copy: CardDraft = { id: newCardId(activeDeck), text: card.text };
    const idx = cards.findIndex((c) => c.id === card.id);
    const next = [...cards];
    next.splice(idx + 1, 0, copy);
    onChange(next);
    setEditing({ id: copy.id, ...parseCard(copy.text) });
  };

  const handleRemove = (id: string) => {
    onChange(cards.filter((c) => c.id !== id));
    if (editing?.id === id) setEditing(null);
  };

  const applyDefaults = () => {
    const defaults = activeDeck === 'roadblock' ? DEFAULT_ROADBLOCKS : DEFAULT_CURSES;
    onChange(JSON.parse(JSON.stringify(defaults)));
    setEditing(null);
    setConfirmingReplace(false);
  };

  /** Replacing a deck that already has cards throws work away — ask first. */
  const handleReplaceWithDefaults = () => {
    if (cards.length === 0) applyDefaults();
    else setConfirmingReplace(true);
  };

  const deckTabs = (['roadblock', 'curse'] as DeckKind[]).map((kind) => {
    const km = DECK_META[kind];
    return {
      id: kind,
      label: km.label,
      icon: <km.Icon />,
      badge: kind === 'roadblock' ? roadblockCards.length : curseCards.length
    };
  });

  return (
    <Dialog open title="DECK WORKSHOP" onClose={onClose} className="dialog--wide">
      <div className="deck-workshop">
        <div className="deck-workshop__switcher">
          <Tabs items={deckTabs} active={activeDeck} onChange={(id) => switchDeck(id as DeckKind)} />
        </div>

        {isEditable && cards.length > 0 && (
          <div className="deck-workshop__toolbar">
            <div className="deck-workshop__toolbar-actions">
              {confirmingReplace ? (
                <span className="deck-workshop__confirm">
                  Discard all {cards.length}?
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingReplace(false)}>
                    Cancel
                  </Button>
                  <Button variant="secondary" size="sm" onClick={applyDefaults}>
                    Replace
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconReset />}
                  className="deck-workshop__replace"
                  onClick={handleReplaceWithDefaults}
                >
                  Replace with defaults
                </Button>
              )}
              <Button variant="primary" size="sm" icon={<IconPlus />} onClick={handleAddCard}>
                Add card
              </Button>
            </div>
          </div>
        )}

        {cards.length === 0 ? (
          <Empty
            icon={<IconDeck />}
            title={`No ${meta.label.toLowerCase()} yet`}
            description={DECK_BLURB[activeDeck]}
            action={
              isEditable ? (
                <div className="deck-workshop__empty-actions">
                  <Button variant="primary" icon={<IconReset />} onClick={applyDefaults}>
                    Start from the default deck
                  </Button>
                  <Button variant="ghost" icon={<IconPlus />} onClick={handleAddCard}>
                    Write the first card
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <div className="deck-grid">
            {cards.map((card, idx) => {
              const isEditingCard = editing?.id === card.id && isEditable;

              if (isEditingCard) {
                return (
                  <div
                    key={card.id}
                    ref={focusFirstField}
                    className={`deck-card deck-card--${activeDeck} deck-card--editing`}
                  >
                    <div className="deck-card__badge">
                      <meta.Icon />
                      <span>
                        {meta.kindLabel} · #{idx + 1}
                      </span>
                    </div>
                    <Input
                      className="deck-card__title-field"
                      value={editing!.title}
                      placeholder="Card title"
                      onChange={(e) => commitEdit({ title: e.target.value })}
                    />
                    <Textarea
                      className="deck-card__body-field"
                      value={editing!.description}
                      placeholder="Describe what the card does…"
                      rows={4}
                      onChange={(e) => commitEdit({ description: e.target.value })}
                    />
                    <div className="deck-card__actions">
                      <IconButton
                        icon={<IconDuplicate />}
                        label="Duplicate card"
                        variant="ghost"
                        onClick={() => handleDuplicate(card)}
                      />
                      <IconButton
                        icon={<IconTrash />}
                        label="Delete card"
                        variant="ghost"
                        onClick={() => handleRemove(card.id)}
                      />
                      <Button variant="primary" icon={<IconDone />} onClick={() => setEditing(null)}>
                        Done
                      </Button>
                    </div>
                  </div>
                );
              }

              const { title, description } = parseCard(card.text);
              return (
                <div
                  key={card.id}
                  className={`deck-card deck-card--${activeDeck} ${isEditable ? 'deck-card--clickable' : ''}`}
                  onClick={() => beginEdit(card)}
                >
                  <div className="deck-card__badge">
                    <meta.Icon />
                    <span>
                      {meta.kindLabel} · #{idx + 1}
                    </span>
                  </div>
                  <div className="deck-card__title">{title || 'Untitled card'}</div>
                  <div className="deck-card__body">
                    {description || (isEditable ? 'Click to add a description…' : '')}
                  </div>
                </div>
              );
            })}

            {isEditable && (
              <button className="deck-card deck-card--add" onClick={handleAddCard}>
                <span className="deck-card--add__plus">
                  <IconPlus />
                </span>
                <span>Add card</span>
              </button>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
};
