import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { REPORT_REGISTRY, type ReportAccent } from '@/lib/reportsAdapter';
import { PageMotion, listContainer, listItem } from '@/lib/motion';

const TILE_STYLES: Record<ReportAccent, string> = {
  inflow: 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25',
  outflow: 'bg-gradient-to-br from-rose-500 to-red-600 shadow-lg shadow-rose-500/25',
  cash: 'bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25',
  warn: 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-orange-500/25',
};

export function ReportsPage() {
  const reduce = useReducedMotion();
  return (
    <PageMotion>
      <PageHeader
        title="Reports"
        subtitle="Seven statement families bound to the live reporting core — pick one and generate."
      />

      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        variants={reduce ? undefined : listContainer}
        initial="initial"
        animate="animate"
      >
        {REPORT_REGISTRY.map((r) => (
          <motion.div
            key={r.id}
            variants={reduce ? undefined : listItem}
            whileHover={reduce ? undefined : { y: -3 }}
            whileTap={reduce ? undefined : { y: -1 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <Link
              to={r.route}
              className="card p-5 hover:shadow-card-hover hover:border-primary-300/70 dark:hover:border-primary-500/40 transition-all group focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-secondary-950 outline-none block h-full"
              aria-label={`${r.title} report — ${r.status === 'wiring' ? 'engine wiring in progress' : 'available'}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`rounded-lg p-2.5 text-white ring-1 ring-inset ring-white/20 ${TILE_STYLES[r.accent]} group-hover:scale-[1.06] transition-transform`}>
                  <r.icon className="h-5 w-5" />
                </div>
                {r.status === 'wiring' ? (
                  <Badge variant="warning">Wiring</Badge>
                ) : (
                  <Badge variant="success">Ready</Badge>
                )}
              </div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 mb-1 group-hover:text-primary-700 dark:group-hover:text-primary-300 transition-colors">{r.title}</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400 line-clamp-2 leading-relaxed">{r.description}</p>
              <div className="flex items-center justify-between mt-3">
                <span className="inline-flex items-center rounded-full bg-secondary-100/80 dark:bg-secondary-800/80 px-2 py-0.5 text-[10px] font-medium tracking-wide text-secondary-500 dark:text-secondary-400">
                  {r.binding}
                </span>
                <ArrowRight className="h-4 w-4 text-secondary-300 group-hover:text-primary-500 group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </PageMotion>
  );
}
