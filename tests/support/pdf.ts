// The PDF builder lives in scripts/lib so the eval corpus loader can use it inside the
// Docker build, which excludes tests/ (.dockerignore). Re-exported here for the tests.
export * from "../../scripts/lib/pdf";
