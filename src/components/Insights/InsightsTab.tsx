import { useEffect } from 'react';
import { getWeeklyStudyTime, getSubjectBreakdown, getEstimatedVsActual, getStudyStreak } from '../../lib/insights';

export default function InsightsTab() {
  useEffect(() => {
    getWeeklyStudyTime();
    getSubjectBreakdown();
    getEstimatedVsActual();
    getStudyStreak();
  }, []);

  return (
    <div>Insights coming soon</div>
  );
}
