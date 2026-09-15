import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/session';
import { can } from '@/lib/auth/roles';
import { getClassDetail } from '@/lib/data/classes';
import { listTeachers } from '@/lib/data/teachers';
import LinkTeacherForm from './link-teacher-form';

export const dynamic = 'force-dynamic';

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const session = await requirePermission('classes:read');
  const { classId } = await params;

  const detail = await getClassDetail(session, classId);
  if (!detail) notFound();

  const mayLink = can(session.role, 'classes:linkTeacher');

  // Only load the picker list if the button will actually render.
  const linkedUids = new Set(
    [detail.owner.uid, ...detail.coTeachers.map((c) => c.userId)].filter(Boolean) as string[]
  );
  const linkedEmails = new Set(detail.coTeachers.map((c) => c.email.toLowerCase()));
  const candidates = mayLink
    ? (await listTeachers()).filter(
        (t) => !linkedUids.has(t.uid) && !linkedEmails.has(t.email.toLowerCase())
      )
    : [];

  return (
    <>
      <Link href="/classes" className="text-sm text-muted hover:underline">
        ← All classes
      </Link>

      <h1 className="mt-2 text-xl font-semibold">{detail.name}</h1>
      {detail.description && <p className="mt-1 text-sm text-muted">{detail.description}</p>}

      <Section title="Owner">
        <p className="text-sm">
          {detail.owner.name}
          <span className="ml-2 text-muted">{detail.owner.email}</span>
        </p>
        <p className="mt-1 font-mono text-xs text-faint">{detail.owner.uid}</p>
      </Section>

      <Section title={`Co-teachers (${detail.coTeachers.length})`}>
        {detail.coTeachers.length === 0 ? (
          <p className="text-sm text-muted">No co-teachers on this class.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Email</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {detail.coTeachers.map((c) => (
                <tr key={c.email}>
                  <td className="py-2">{c.name}</td>
                  <td className="py-2">{c.email}</td>
                  <td className="py-2">
                    <span
                      className={
                        c.inviteStatus === 'accepted'
                          ? 'rounded bg-ok-bg px-1.5 py-0.5 text-xs text-ok-fg'
                          : 'rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn-fg'
                      }
                    >
                      {c.inviteStatus}
                    </span>
                    {c.inconsistent && (
                      <span
                        className="ml-2 rounded bg-danger-bg px-1.5 py-0.5 text-xs text-danger-fg"
                        title="Marked accepted but has no userId — this teacher will not actually see the class."
                      >
                        no userId
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {mayLink && (
          <div className="mt-5 border-t border-subtle pt-4">
            <LinkTeacherForm classId={detail.id} teachers={candidates} />
          </div>
        )}
      </Section>

      <Section title={`Students (${detail.students.length})`}>
        {detail.students.length === 0 ? (
          <p className="text-sm text-muted">No students in this class.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="pb-2 font-medium">Student</th>
                <th className="pb-2 font-medium">Parents</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {detail.students.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 align-top">{s.name}</td>
                  <td className="py-2">
                    {s.parents.length === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      s.parents.map((p) => (
                        <div key={p.email} className="mb-1 last:mb-0">
                          {p.name}{' '}
                          <span className="text-muted">{p.email}</span>{' '}
                          <span className="text-xs text-faint">({p.inviteStatus})</span>
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-lg border border-subtle bg-surface p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}
