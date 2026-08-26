import { BlogPostStatus, type Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../common/AppError.js";
import { createAuditLog } from "../../lib/audit.js";
import { asyncHandler, paramValue } from "../../lib/http.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const blogRoutes = Router();

const blogPostPayloadSchema = z.object({
  title: z.string().trim().min(8).max(180),
  slug: z.string().trim().min(3).max(160).optional(),
  summary: z.string().trim().min(24).max(360),
  body: z.string().trim().min(80),
  coverImageUrl: z.string().trim().url().max(2048).optional().or(z.literal("")).or(z.null()),
  status: z.nativeEnum(BlogPostStatus),
  publishedAt: z.string().datetime().optional().or(z.literal("")).or(z.null())
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function buildPublishedAt(inputStatus: BlogPostStatus, publishedAt?: string | null) {
  if (inputStatus !== BlogPostStatus.PUBLISHED) {
    return null;
  }

  if (!publishedAt) {
    return new Date();
  }

  const parsed = new Date(publishedAt);
  if (Number.isNaN(parsed.valueOf())) {
    throw new AppError("Published date is invalid.", 400, "INVALID_PUBLISHED_AT");
  }

  return parsed;
}

function formatBlogPost(post: {
  id: string;
  title: string;
  slug: string;
  summary: string;
  body: string;
  coverImageUrl: string | null;
  status: BlogPostStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; fullName: string; email: string } | null;
}) {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    summary: post.summary,
    body: post.body,
    coverImageUrl: post.coverImageUrl,
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    author: post.author
      ? {
          id: post.author.id,
          fullName: post.author.fullName,
          email: post.author.email
        }
      : null
  };
}

async function ensureSlugAvailable(slug: string, currentId?: string) {
  const existing = await prisma.blogPost.findUnique({
    where: { slug },
    select: { id: true }
  });

  if (existing && existing.id !== currentId) {
    throw new AppError("Another blog article already uses this slug.", 409, "BLOG_SLUG_TAKEN");
  }
}

blogRoutes.get(
  "/blog-posts",
  asyncHandler(async (_request, response) => {
    const posts = await prisma.blogPost.findMany({
      where: {
        status: BlogPostStatus.PUBLISHED
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }]
    });

    response.json(posts.map(formatBlogPost));
  })
);

blogRoutes.get(
  "/blog-posts/:slug",
  asyncHandler(async (request, response) => {
    const slug = slugify(paramValue(request.params.slug));
    const post = await prisma.blogPost.findFirst({
      where: {
        slug,
        status: BlogPostStatus.PUBLISHED
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      }
    });

    if (!post) {
      throw new AppError("Blog article not found.", 404, "BLOG_POST_NOT_FOUND");
    }

    response.json(formatBlogPost(post));
  })
);

blogRoutes.get(
  "/admin/blog-posts",
  requireAuth,
  requireRole(["admin", "marketing"]),
  asyncHandler(async (_request, response) => {
    const posts = await prisma.blogPost.findMany({
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }]
    });

    response.json(posts.map(formatBlogPost));
  })
);

blogRoutes.post(
  "/admin/blog-posts",
  requireAuth,
  requireRole(["admin", "marketing"]),
  asyncHandler(async (request, response) => {
    const payload = blogPostPayloadSchema.parse(request.body);
    const slug = slugify(payload.slug || payload.title);

    if (!slug) {
      throw new AppError("Provide a valid title or slug for this article.", 400, "INVALID_BLOG_SLUG");
    }

    await ensureSlugAvailable(slug);

    const publishedAt = buildPublishedAt(payload.status, payload.publishedAt || null);

    const blogPost = await prisma.blogPost.create({
      data: {
        title: payload.title.trim(),
        slug,
        summary: payload.summary.trim(),
        body: payload.body.trim(),
        coverImageUrl: payload.coverImageUrl?.trim() || null,
        status: payload.status,
        publishedAt,
        authorId: request.auth?.userId
      },
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      }
    });

    await createAuditLog({
      actorId: request.auth?.userId,
      action: "BLOG_POST_CREATED",
      entityType: "BlogPost",
      entityId: blogPost.id,
      details: {
        slug: blogPost.slug,
        status: blogPost.status
      }
    });

    response.status(201).json(formatBlogPost(blogPost));
  })
);

blogRoutes.patch(
  "/admin/blog-posts/:postId",
  requireAuth,
  requireRole(["admin", "marketing"]),
  asyncHandler(async (request, response) => {
    const postId = paramValue(request.params.postId);
    const payload = blogPostPayloadSchema.partial().parse(request.body);
    const existing = await prisma.blogPost.findUnique({
      where: { id: postId }
    });

    if (!existing) {
      throw new AppError("Blog article not found.", 404, "BLOG_POST_NOT_FOUND");
    }

    const nextTitle = payload.title?.trim() || existing.title;
    const nextSlug = slugify(payload.slug || payload.title || existing.slug);
    if (!nextSlug) {
      throw new AppError("Provide a valid title or slug for this article.", 400, "INVALID_BLOG_SLUG");
    }

    await ensureSlugAvailable(nextSlug, existing.id);

    const nextStatus = payload.status ?? existing.status;
    const nextPublishedAt =
      payload.publishedAt !== undefined || payload.status !== undefined
        ? buildPublishedAt(nextStatus, payload.publishedAt ?? existing.publishedAt?.toISOString() ?? null)
        : existing.publishedAt;

    const data: Prisma.BlogPostUpdateInput = {
      title: nextTitle,
      slug: nextSlug,
      summary: payload.summary?.trim() ?? existing.summary,
      body: payload.body?.trim() ?? existing.body,
      coverImageUrl:
        payload.coverImageUrl !== undefined ? payload.coverImageUrl?.trim() || null : existing.coverImageUrl,
      status: nextStatus,
      publishedAt: nextPublishedAt,
      author: request.auth?.userId
        ? {
            connect: {
              id: request.auth.userId
            }
          }
        : undefined
    };

    const blogPost = await prisma.blogPost.update({
      where: { id: existing.id },
      data,
      include: {
        author: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      }
    });

    await createAuditLog({
      actorId: request.auth?.userId,
      action: "BLOG_POST_UPDATED",
      entityType: "BlogPost",
      entityId: blogPost.id,
      details: {
        slug: blogPost.slug,
        status: blogPost.status
      }
    });

    response.json(formatBlogPost(blogPost));
  })
);

blogRoutes.delete(
  "/admin/blog-posts/:postId",
  requireAuth,
  requireRole(["admin", "marketing"]),
  asyncHandler(async (request, response) => {
    const postId = paramValue(request.params.postId);
    const existing = await prisma.blogPost.findUnique({
      where: { id: postId },
      select: { id: true, slug: true }
    });

    if (!existing) {
      throw new AppError("Blog article not found.", 404, "BLOG_POST_NOT_FOUND");
    }

    await prisma.blogPost.delete({
      where: { id: postId }
    });

    await createAuditLog({
      actorId: request.auth?.userId,
      action: "BLOG_POST_DELETED",
      entityType: "BlogPost",
      entityId: existing.id,
      details: {
        slug: existing.slug
      }
    });

    response.status(204).send();
  })
);
