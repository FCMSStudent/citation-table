import { getSupabase } from '@/integrations/supabase/fallback';
import { reportKeys } from '@/entities/report/api/report.queries';
import type { StudyPdf } from '@/shared/types/research';

export { reportKeys };

export async function fetchStudyPdfs(reportId: string): Promise<Record<string, StudyPdf>> {
  const client = getSupabase();

  const { data, error } = await client
    .from('study_pdfs')
    .select('*')
    .eq('report_id', reportId);

  if (error) {
    throw new Error(error.message);
  }

  const byDoi: Record<string, StudyPdf> = {};
  (data ?? []).forEach((pdf) => {
    byDoi[pdf.doi] = pdf as unknown as StudyPdf;
  });

  return byDoi;
}

export function hasPendingStudyPdfs(pdfsByDoi: Record<string, StudyPdf> | null | undefined): boolean {
  if (!pdfsByDoi) return false;
  return Object.values(pdfsByDoi).some((pdf) => pdf.status === 'pending');
}
