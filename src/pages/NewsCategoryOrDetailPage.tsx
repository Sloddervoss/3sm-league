import { useParams } from "react-router-dom";
import NewsDetailPage from "./NewsDetailPage";
import NewsPage from "./NewsPage";
import { categorySlugToLabel } from "@/lib/newsTaxonomy";

const NewsCategoryOrDetailPage = () => {
  const { categorySlug } = useParams();
  return categorySlugToLabel(categorySlug) ? <NewsPage /> : <NewsDetailPage />;
};

export default NewsCategoryOrDetailPage;
