export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "schema": "schema" });
  eleventyConfig.addPassthroughCopy({ "src/_headers": "_headers" });  // Pages cache headers

  // Human-readable date for display: 2026-06-21 -> "21 June 2026"
  eleventyConfig.addFilter("displayDate", (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB",
      { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));

  return {
    dir: { input: "src", output: "build", layouts: "_layouts", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
