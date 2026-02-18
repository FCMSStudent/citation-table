import { createContext, useContext } from 'react';
import type { useStudyTableState } from '@/features/studyTable/model/useStudyTableState';

type StudyTableState = ReturnType<typeof useStudyTableState>;

const StudyTableContext = createContext<StudyTableState | null>(null);

export function StudyTableProvider({
  value,
  children,
}: {
  value: StudyTableState;
  children: React.ReactNode;
}) {
  return <StudyTableContext.Provider value={value}>{children}</StudyTableContext.Provider>;
}

export function useStudyTableContext() {
  const ctx = useContext(StudyTableContext);
  if (!ctx) throw new Error('useStudyTableContext must be used inside StudyTableProvider');
  return ctx;
}
