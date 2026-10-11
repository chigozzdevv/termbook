import { startPages } from "./start";
import { conceptPages } from "./concepts";
import { integrationPages } from "./integrations";
import { useCasePages } from "./use-cases";
import { sdkPages } from "./sdk";
import { operationPages } from "./operations";

export const pages = [...startPages, ...conceptPages, ...integrationPages, ...useCasePages, ...sdkPages, ...operationPages];
export const findPage = (slug: string) => pages.find((page) => page.slug === slug);
