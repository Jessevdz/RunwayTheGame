import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { metaFor } from './documentMeta';

/** Finds or creates a `<meta>` in the head and sets its content. */
function setMeta(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Drops a tag the current surface must not carry, if an earlier one left it behind. */
function removeTag(selector: string): void {
  document.head.querySelector(selector)?.remove();
}

/** Points the canonical link at this path on whatever origin is serving the app. */
function setCanonical(path: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', `${window.location.origin}${path}`);
}

/**
 * Keeps the document title, description and indexability in step with the route.
 */
export function useDocumentMeta(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = metaFor(pathname);
    document.title = meta.title;
    setMeta('description', meta.description);

    // A `noindex` page has nothing to consolidate, so the two are never set together.
    if (meta.indexable) {
      removeTag('meta[name="robots"]');
      setCanonical(pathname);
    } else {
      setMeta('robots', 'noindex, follow');
      removeTag('link[rel="canonical"]');
    }
  }, [pathname]);
}
