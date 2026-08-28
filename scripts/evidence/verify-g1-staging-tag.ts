import { verifyG1StagingTag } from "./publish-g1-staging-tag";

const tagName = await verifyG1StagingTag();
console.log("G1_EVIDENCE_TAG_VERIFIED=" + tagName);
