import { Article } from "@/features/docs/article";
import { pages } from "@/features/docs/content";

export default function Page() {
  return <Article page={pages[0]} next={pages[1]} />;
}
