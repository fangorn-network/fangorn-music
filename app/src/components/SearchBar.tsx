import { useEffect, useState } from 'react';
import { warm } from '../lib/client';
import { goSearch } from '../lib/router';

export default function SearchBar({ initial = '', autoFocus = false }: { initial?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState(initial);
  // A new search arrives by the URL as often as by typing: show it.
  useEffect(() => setQ(initial), [initial]);
  return (
    <form
      className="search"
      onSubmit={(e) => { e.preventDefault(); if (q.trim()) goSearch(q.trim()); }}
      role="search"
    >
      <input
        value={q}
        // Typing is the intent to search: start the model then, not with the page.
        onChange={(e) => { setQ(e.target.value); void warm(); }}
        placeholder="Describe what you want to hear"
        aria-label="Search the catalogue"
        autoFocus={autoFocus}
      />
      <button type="submit" disabled={!q.trim()}>Search</button>
    </form>
  );
}
