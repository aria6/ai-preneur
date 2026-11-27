import { EmptyState, PageHeader } from '../../../components/ui/feedback';

/** Placeholder until the analyses are decided. Works on the Data Collection AIgent's data. */
export function AudienceInsightPage() {
  return (
    <>
      <PageHeader
        title="Audience Insight Analysis AIgent"
        description="Menganalisis komentar dan DM yang sudah dikumpulkan Data Collection AIgent."
      />
      <EmptyState
        icon="sparkles"
        title="Segera hadir"
        description="Analisis audiens dengan AI akan tersedia di sini, memakai data dari Data Collection AIgent."
      />
    </>
  );
}
