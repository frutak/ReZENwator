import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

const auditMiddleware = t.middleware(async ({ type, path, ctx, next, getRawInput }) => {
  const start = Date.now();
  const result = await next();
  const durationMs = Date.now() - start;

  if (type === "mutation") {
    const user = ctx.user ? ctx.user.username : "System/Public";
    const status = result.ok ? "OK" : "ERROR";
    console.log(`[Audit] [${status}] ${user} executed ${path} in ${durationMs}ms`);
  }
  
  return result;
});

const propertyAccessMiddleware = t.middleware(async ({ ctx, next, getRawInput }) => {
  const input = await getRawInput() as any;
  
  if (ctx.user?.propertyAccess && input && input.property) {
    if (input.property !== ctx.user.propertyAccess) {
      throw new TRPCError({ 
        code: "FORBIDDEN", 
        message: `You are restricted to ${ctx.user.propertyAccess} only.` 
      });
    }
  }
  
  return next();
});

export const router = t.router;
export const publicProcedure = t.procedure.use(auditMiddleware).use(propertyAccessMiddleware);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(auditMiddleware).use(propertyAccessMiddleware).use(requireUser);

export const adminProcedure = t.procedure.use(auditMiddleware).use(propertyAccessMiddleware).use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
