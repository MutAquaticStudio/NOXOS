export const projectOperationsPermissions = {
  read: "module.project-operations.read",
  createProject: "module.project-operations.project.create",
  editProject: "module.project-operations.project.edit",
  activate: "module.project-operations.project.activate",
  hold: "module.project-operations.project.hold",
  resume: "module.project-operations.project.resume",
  completeProject: "module.project-operations.project.complete",
  cancelProject: "module.project-operations.project.cancel",
  managePhase: "module.project-operations.phase.manage",
  createTask: "module.project-operations.task.create",
  editTask: "module.project-operations.task.edit",
  startTask: "module.project-operations.task.start",
  completeTask: "module.project-operations.task.complete",
  cancelTask: "module.project-operations.task.cancel",
  manageDependency: "module.project-operations.dependency.manage",
  manageArtifact: "module.project-operations.artifact-link.manage",
  createUpdate: "module.project-operations.update.create"
} as const;
