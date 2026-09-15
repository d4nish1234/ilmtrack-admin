import { requirePermission } from '@/lib/auth/session';
import { listClasses } from '@/lib/data/classes';
import ClassTable from './class-table';

export const dynamic = 'force-dynamic';

export default async function ClassesPage() {
  const session = await requirePermission('classes:read');
  const classes = await listClasses(session);

  return (
    <>
      <h1 className="text-xl font-semibold">Classes</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        {classes.length} {classes.length === 1 ? 'class' : 'classes'} across all teachers.
      </p>
      <ClassTable classes={classes} />
    </>
  );
}
