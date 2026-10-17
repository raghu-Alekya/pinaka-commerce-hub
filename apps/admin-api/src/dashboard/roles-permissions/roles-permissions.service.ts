import { Inject, Injectable } from '@nestjs/common';
import { DashboardDatabase } from '../dashboard.database';
import { RolesPermissionsResponseDto } from './dto/roles-permissions-response.dto';

type MetricRow = {
  activeRoleTemplates: string | number;
  systemRoles: string | number;
  activeRoleAssignments: string | number;
  totalPermissions: string | number;
  employeesAssigned: string | number;
  rolesRequiringAttention: string | number;
};

@Injectable()
export class RolesPermissionsService {
  constructor(@Inject(DashboardDatabase) private readonly database: DashboardDatabase) {}

  async getSummary(): Promise<RolesPermissionsResponseDto> {
    const dataSource = await this.database.getConnection();
    const [row] = await dataSource.query<MetricRow[]>(`
      SELECT
        (SELECT COUNT(*)::integer FROM public.role_templates rt
          WHERE COALESCE(to_jsonb(rt)->>'status', '') = 'ACTIVE') AS "activeRoleTemplates",
        (SELECT COUNT(*)::integer FROM public.role_templates rt
          WHERE COALESCE(to_jsonb(rt)->>'status', '') = 'ACTIVE') AS "systemRoles",
        (SELECT COUNT(*)::integer FROM public.employee_store_roles esr
          WHERE COALESCE(to_jsonb(esr)->>'status', '') = 'ACTIVE') AS "activeRoleAssignments",
        (SELECT COUNT(*)::integer FROM public.feature_permissions p
          WHERE COALESCE(to_jsonb(p)->>'status', 'ACTIVE') = 'ACTIVE') AS "totalPermissions",
        (SELECT COUNT(DISTINCT es.employee_id)::integer
           FROM public.employee_store_roles esr
           JOIN public.employee_stores es ON es.id = esr.employee_store_id
           JOIN public.employees e ON e.id = es.employee_id
          WHERE COALESCE(to_jsonb(esr)->>'status', '') = 'ACTIVE'
            AND COALESCE(to_jsonb(es)->>'status', 'ACTIVE') = 'ACTIVE'
            AND COALESCE(to_jsonb(e)->>'status', '') = 'ACTIVE') AS "employeesAssigned",
        (SELECT COUNT(*)::integer
           FROM public.role_templates rt
          WHERE COALESCE(to_jsonb(rt)->>'status', '') = 'ACTIVE'
            AND NOT EXISTS (
              SELECT 1 FROM public.role_template_permissions rtp
               WHERE rtp.role_template_id = rt.id
                 AND COALESCE(to_jsonb(rtp)->>'status', 'ACTIVE') = 'ACTIVE'
            )) AS "rolesRequiringAttention"`);

    return {
      activeRoleTemplates: Number(row.activeRoleTemplates),
      systemRoles: Number(row.systemRoles),
      customRoles: null,
      activeRoleAssignments: Number(row.activeRoleAssignments),
      totalPermissions: Number(row.totalPermissions),
      employeesAssigned: Number(row.employeesAssigned),
      rolesRequiringAttention: Number(row.rolesRequiringAttention),
      generatedAt: new Date().toISOString(),
    };
  }
}
