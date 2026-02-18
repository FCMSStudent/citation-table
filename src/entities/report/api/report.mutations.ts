import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/integrations/supabase/fallback';
import { reportKeys } from '@/entities/report/api/report.queries';

interface AddStudyInput {
  reportId: string;
  doi: string;
}

interface AddStudyResponse {
  study?: {
    title?: string;
  };
}

interface SynthesizeResponse {
  synthesis: string;
}

async function addStudyByDoi({ reportId, doi }: AddStudyInput): Promise<AddStudyResponse> {
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<AddStudyResponse>('add-study', {
    body: { report_id: reportId, doi },
  });

  if (error) {
    throw new Error(error.message || 'Failed to add study');
  }

  return data ?? {};
}

async function synthesizeReport({ reportId }: { reportId: string }): Promise<SynthesizeResponse> {
  const client = getSupabase();
  const { data, error } = await client.functions.invoke<SynthesizeResponse>('synthesize-papers', {
    body: { report_id: reportId },
  });

  if (error) {
    throw new Error(error.message || 'Failed to generate synthesis');
  }

  if (!data?.synthesis) {
    throw new Error('Synthesis response is missing payload');
  }

  return data;
}

export function useAddStudyMutation(reportId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (doi: string) => addStudyByDoi({ reportId, doi: doi.trim() }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reportKeys.detail(reportId) }),
        queryClient.invalidateQueries({ queryKey: reportKeys.studyPdfs(reportId) }),
        queryClient.invalidateQueries({ queryKey: reportKeys.extractionRuns(reportId) }),
        queryClient.invalidateQueries({ queryKey: reportKeys.lists() }),
      ]);
    },
  });
}

export function useGenerateSummaryMutation(reportId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => synthesizeReport({ reportId }),
    onSuccess: async ({ synthesis }) => {
      queryClient.setQueryData(reportKeys.summary(reportId), synthesis);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reportKeys.summary(reportId) }),
        queryClient.invalidateQueries({ queryKey: reportKeys.detail(reportId) }),
      ]);
    },
  });
}
