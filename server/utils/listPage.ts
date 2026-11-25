import type { RequestHandler } from "express";

type Page = {
    page: number;
    limit: number;
    sortBy: string;
    direction: "asc" | "desc";
    search: string;
    searchField: string;
};

export function listPage(searchField: string, sortFields: string[]): RequestHandler {
    return (req, res, next) => {
        const { page, limit, sortBy, sortOrder, search } = req.query;
        if ([page, limit, sortBy, sortOrder, search].every(value => value === undefined)) return next();
        const integer = (value: unknown, fallback: number, max: number) => {
            if (value === undefined) return fallback;
            return typeof value === "string" && /^[1-9]\d*$/.test(value) && Number(value) <= max ? Number(value) : NaN;
        };
        const number = integer(page, 1, 1_000_000);
        const size = integer(limit, 50, 100);
        const field = sortBy ?? "id";
        const direction = sortOrder ?? "asc";
        if (!number || !size || typeof field !== "string" || !["id", ...sortFields].includes(field)
            || (direction !== "asc" && direction !== "desc")
            || (search !== undefined && (typeof search !== "string" || search.length > 100
                || (searchField === "examId" && !/^[1-9]\d{0,8}$/.test(search))))) {
            return res.status(400).json({ message: "Invalid page, limit, search or sort parameters" });
        }
        res.locals.page = { page: number, limit: size, sortBy: field, direction, search: search?.trim() || "", searchField } satisfies Page;
        next();
    };
}

export function pageQuery(page?: Page): { skip?: number; take?: number; orderBy?: Record<string, "asc" | "desc">[] } {
    if (!page) return {};
    const orderBy = [{ [page.sortBy]: page.direction }];
    if (page.sortBy !== "id") orderBy.push({ id: page.direction });
    return { skip: (page.page - 1) * page.limit, take: page.limit + 1, orderBy };
}

export function pageFilter(page?: Page): Record<string, number | { contains: string; mode: "insensitive" }> {
    if (!page?.search) return {};
    return page.searchField === "examId"
        ? { examId: Number(page.search) }
        : { [page.searchField]: { contains: page.search, mode: "insensitive" as const } };
}

export function listRows<T>(rows: T[], page?: Page) {
    if (!page) return { data: rows };
    return {
        data: rows.slice(0, page.limit),
        pagination: { page: page.page, limit: page.limit, hasMore: rows.length > page.limit },
    };
}
