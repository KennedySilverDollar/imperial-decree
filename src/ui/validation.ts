import type { ValidationIssue } from "../services/errors";
import { messages } from "../i18n/messages";

export const validationMessage = (issue: ValidationIssue): string => {
  const v = messages.validation;
  switch (issue.kind) {
    case "empty":
      return v.empty;
    case "tooLong":
      return v.tooLong(issue.used, issue.limit);
    case "tooManyTags":
      return v.tooManyTags(issue.count);
    case "duplicateTag":
      return v.duplicateTag;
    case "noPoliticalCapital":
      return v.noPoliticalCapital;
    case "invalidIntent":
      return v.invalidIntent;
    case "aidesFull":
      return v.aidesFull;
    case "unknownCandidate":
      return v.unknownCandidate;
    case "unknownAide":
      return v.unknownAide;
  }
};
