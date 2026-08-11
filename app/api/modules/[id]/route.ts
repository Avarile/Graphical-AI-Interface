// One module.
//
//   PUT     replace it — this is what an edit in the panel becomes
//   DELETE  remove it
//
// PUT, not PATCH: the form reads every control into a complete module on each
// commit, so there is no partial update to apply and a PATCH would be a lie
// about what the request carries.
//
// The id in the path is the one the module is *stored* under. A rename sends the
// new id in the body, so `PUT /api/modules/old-id` with `{"id": "new-id", …}` is
// how a module is renamed — the same edit as any other, since there are no
// foreign keys pointing at it.

import { NextResponse } from 'next/server';
import { acceptModule, fail, readJson } from '@/lib/api/http';
import { deleteModule, getModule, hasModule, updateModule } from '@/lib/db/modules-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Context) {
  const { id } = await ctx.params;
  try {
    const module = getModule(id);
    if (!module) return fail('no module with the id "' + id + '"', 404);
    return NextResponse.json({ module }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return fail('could not read the module: ' + (err as Error).message, 500);
  }
}

export async function PUT(request: Request, ctx: Context) {
  const { id } = await ctx.params;
  const { body, error } = await readJson(request);
  if (error) return fail(error, 400);

  const { module: mod, error: bad } = acceptModule(body);
  if (!mod) return fail(bad!, 422);

  try {
    if (!hasModule(id)) return fail('no module with the id "' + id + '"', 404);
    // A rename may not land on someone else's id — the same check the panel
    // makes before it will commit one.
    if (mod.id !== id && hasModule(mod.id)) {
      return fail('another module already uses the id "' + mod.id + '"', 409);
    }
    const saved = updateModule(id, mod);
    if (!saved) return fail('no module with the id "' + id + '"', 404);
    return NextResponse.json({ module: saved });
  } catch (err) {
    return fail('could not save the module: ' + (err as Error).message, 500);
  }
}

export async function DELETE(_request: Request, ctx: Context) {
  const { id } = await ctx.params;
  try {
    if (!deleteModule(id)) return fail('no module with the id "' + id + '"', 404);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return fail('could not delete the module: ' + (err as Error).message, 500);
  }
}
