import React, { useState, useEffect } from 'react';
import { Dialog, Input, Textarea, Select, Button, Notice } from '@ds';
import type { ApiRoadmapItem } from '../../../core/api/client';

export interface EditItemDialogProps {
  open: boolean;
  item: ApiRoadmapItem | null;
  onClose: () => void;
  onSubmit: (id: string, data: { title: string; description: string; status: ApiRoadmapItem['status'] }) => Promise<void>;
}

export const EditItemDialog: React.FC<EditItemDialogProps> = ({
  open,
  item,
  onClose,
  onSubmit
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ApiRoadmapItem['status']>('PROPOSED');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setDescription(item.description || '');
      setStatus(item.status);
      setError(null);
    }
  }, [item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(item.id, {
        title: title.trim(),
        description: description.trim(),
        status
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update roadmap item');
    } finally {
      setSubmitting(false);
    }
  };

  if (!item) return null;

  return (
    <Dialog open={open} title="Edit Roadmap Item" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {error && <Notice kind="stop">{error}</Notice>}

        <Input
          label="Title *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <Textarea
          label="Description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <Select
          label="Lane / Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ApiRoadmapItem['status'])}
        >
          <option value="PROPOSED">Proposed</option>
          <option value="PLANNED">Planned</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="SHIPPED">Shipped</option>
        </Select>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-3)', marginTop: 'var(--sp-2)' }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting || !title.trim()}>
            {submitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
