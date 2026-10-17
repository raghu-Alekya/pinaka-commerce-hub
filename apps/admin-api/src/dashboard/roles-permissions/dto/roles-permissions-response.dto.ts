export interface RolesPermissionsResponseDto {
  activeRoleTemplates: number;
  systemRoles: number;
  customRoles: number | null;
  activeRoleAssignments: number;
  totalPermissions: number;
  employeesAssigned: number;
  rolesRequiringAttention: number;
  generatedAt: string;
}
