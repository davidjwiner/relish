import { createContext, useContext, useState, type ReactNode } from 'react';
const DraftContext = createContext<Map<string, string> | null>(null);
export function ChatDrafts({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, string>());
  return (
    <DraftContext.Provider value={drafts}>{children}</DraftContext.Provider>
  );
}
// Kept within the authenticated shell; logout destroys every draft.
// eslint-disable-next-line react-refresh/only-export-components
export function useChatDrafts() {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error('ChatDrafts provider is missing');
  return drafts;
}
