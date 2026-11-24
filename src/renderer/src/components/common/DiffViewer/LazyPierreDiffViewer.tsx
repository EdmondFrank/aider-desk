import { lazy, Suspense } from 'react';

import type { PierreDiffViewerProps } from './PierreDiffViewer';

const LazyPierreDiffViewer = lazy(() => import('./PierreDiffViewer').then((module) => ({ default: module.PierreDiffViewer })));

export const PierreDiffViewer = (props: PierreDiffViewerProps) => (
  <Suspense fallback={null}>
    <LazyPierreDiffViewer {...props} />
  </Suspense>
);
