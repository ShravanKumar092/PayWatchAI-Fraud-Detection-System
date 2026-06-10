import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAppData } from "../context/AppDataContext";
import EmptyState from "../components/EmptyState";
import SkeletonBlock from "../components/SkeletonBlock";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  approveUser,
  getObservabilityLogs,
  getSettings,
  getTeamSettings,
  sendTestEmail,
  updateSettings,
  updateSettingsProfile,
  updateTeamPermissions,
  updateUserRole,
  updateUserStatus
} from "../services/api";

function formatTimestamp(value) {
  if (!value) {
    return "Not available";
  }
  return String(value).replace("T", " ").slice(0, 19);
}

function applyTheme(theme) {
  try {
    localStorage.setItem("paywatch_theme_mode", theme);
  } catch (error) {
    // ignore localStorage issues
  }
  document.documentElement.setAttribute("data-theme", theme);
}

function createNotificationRule() {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "New Notification Rule",
    channel: "webhook",
    severity: "high",
    condition: "risk_level == HIGH",
    enabled: true,
  };
}

export default function SettingsPage() {
  const { token, email } = useAuth();
  const { refreshAll } = useAppData();
  const { pushToast } = useWorkspace();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [pageLoading, setPageLoading] = useState(false);
  const [permissions, setPermissions] = useState({});
  const [profile, setProfile] = useState({
    display_name: "",
    avatar_url: "",
    contact_email: "",
    contact_phone: "",
    timezone: "Asia/Calcutta",
    language: "en",
    theme: "dark",
    default_filters: { time_range: "24h", risk_level: "ALL", transaction_type: "ALL", model_view: "ensemble" },
    table_density: "comfortable",
    notification_style: "detailed"
  });
  const [settingsState, setSettingsState] = useState({
    fraud_threshold_high: 0.8,
    fraud_threshold_medium: 0.55,
    email_alerts_enabled: true,
    sms_alerts_enabled: false,
    currency: "USD",
    theme_mode: "dark",
    alert_preferences: {
      channels: { email: true, sms: false, webhook: true },
      severity: { low: false, medium: true, high: true, critical: true },
      quiet_hours: { enabled: false, start: "22:00", end: "06:00" }
    },
    alert_delivery: {
      email_recipient: "",
      email_sender: "alerts@paywatch.local",
      smtp_host: "",
      smtp_port: 1025,
      smtp_username: "",
      smtp_password: "",
      starttls: false,
      require_auth: false
    },
    tenant_branding: { org_name: "PayWatch AI", workspace_title: "Fintech Fraud Platform", tagline: "Real-time fraud intelligence", accent_primary: "#5cc8ff", accent_secondary: "#ffc14d", logo_mode: "3d-mark" },
    notification_rules: [
      { id: "critical-email", name: "Critical Email Escalation", channel: "email", severity: "critical", condition: "risk_level == HIGH", enabled: true },
      { id: "sms-escalation", name: "SMS Escalation", channel: "sms", severity: "critical", condition: "fraud_probability >= 0.85", enabled: false },
      { id: "webhook-ops", name: "Webhook Ops Feed", channel: "webhook", severity: "high", condition: "assigned_to == triage", enabled: true },
    ],
    model_settings: { selected_model: "ensemble", fallback_policy: "graceful", explanation_depth: "standard" },
    model_access: { approval_required: true, approvers: ["admin@paywatch.ai"], activation_roles: ["ADMIN", "SERVICE"], promotion_envs: [{ environment: "staging", enabled: true, requires_approval: false }, { environment: "production", enabled: true, requires_approval: true }], current_environment: "production", promotion_notes: "" },
    feature_flags: { experimental_dashboard: true, graph_layer: true, anomaly_layer: true, replay_mode: true, comparison_mode: true },
    audit_settings: { retention_days: 90, masking_policy: "partial", export_policy: "admin_only", review_logs: true },
    access_policy: { session_timeout_minutes: 45, ip_allowlist: "", download_permission: "reviewers", evidence_retention_days: 365 },
    reporting: { schedule: "weekly", brand_template: "executive", default_chart_interval: "hourly", casebook_workspace: true, ai_summary_panel: true },
    onboarding: { guided_mode: true, analyst_template: "standard triage", productivity_default: "sla-first", collaboration_presence: true },
    alert_workflow: { similarity_threshold: 0.72, dedupe_window_minutes: 30, auto_merge_incidents: true, suppression_rules: [], escalation_policy: [] }
  });
  const [environment, setEnvironment] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [observabilityMeta, setObservabilityMeta] = useState({
    log_file: "",
    prometheus_enabled: false,
    grafana_ready: false,
  });
  const [observabilityLogs, setObservabilityLogs] = useState([]);
  const [team, setTeam] = useState({ approval_queue: [], members: [], permission_columns: [] });
  const [busyUser, setBusyUser] = useState(null);
  const [testEmailBusy, setTestEmailBusy] = useState(false);
  const themePreference = profile.theme || settingsState.theme_mode || "dark";
  const canManagePlatform = Boolean(permissions.can_manage_system_settings);

  async function loadPage() {
    if (!token) {
      return;
    }
    try {
      setPageLoading(true);
      const payload = await getSettings(token);
      const logsPayload = await getObservabilityLogs(token, 60).catch(() => null);
      setPermissions(payload.permissions || {});
      const nextProfile = {
        ...(payload.profile || {}),
        ...(payload.preferences || {})
      };
      setProfile((current) => ({
        ...current,
        ...nextProfile,
        default_filters: nextProfile.default_filters || current.default_filters
      }));
      const resolvedThemeMode =
        payload.preferences?.theme ||
        payload.profile?.theme ||
        payload.settings?.theme_mode ||
        payload.settings?.theme ||
        currentThemeModeFallback();
      setSettingsState((current) => ({
        ...current,
        ...(payload.settings || {}),
        theme_mode: resolvedThemeMode,
        theme: resolvedThemeMode,
        email_alerts_enabled: payload.preferences?.email_alerts_enabled ?? payload.settings?.email_alerts_enabled ?? current.email_alerts_enabled,
        sms_alerts_enabled: payload.preferences?.sms_alerts_enabled ?? payload.settings?.sms_alerts_enabled ?? current.sms_alerts_enabled,
        alert_preferences: payload.preferences?.alert_preferences || payload.settings?.alert_preferences || current.alert_preferences,
        alert_delivery: payload.preferences?.alert_delivery || payload.settings?.alert_delivery || current.alert_delivery,
      }));
      setEnvironment(payload.environment_status || null);
      setAuditLogs(payload.audit_logs || []);
      if (logsPayload) {
        setObservabilityMeta({
          log_file: logsPayload.log_file || "",
          prometheus_enabled: Boolean(logsPayload.prometheus_enabled),
          grafana_ready: Boolean(logsPayload.grafana_ready),
        });
        setObservabilityLogs(logsPayload.events || logsPayload.recent_events || []);
      }
      applyTheme(resolvedThemeMode);

      if (payload.permissions?.can_manage_users) {
        setTeam(await getTeamSettings(token));
      }
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Unable to load settings");
    } finally {
      setPageLoading(false);
    }
  }

  useEffect(() => {
    loadPage();
  }, [token]);

  function currentThemeModeFallback() {
    return profile.theme || settingsState.theme_mode || "dark";
  }

  function renderPlatformSaveButton(label = "Save Platform Settings") {
    return (
      <button
        className={canManagePlatform ? "primary-button" : "secondary-button"}
        type="button"
        onClick={canManagePlatform ? savePlatformSettings : undefined}
        disabled={!canManagePlatform}
      >
        {label}
      </button>
    );
  }

  function renderPlatformReadonlyNote() {
    if (canManagePlatform) {
      return null;
    }
    return (
      <div className="empty-state">
        Admin access is required to change platform-wide settings in this section. Your personal profile and alert preferences above are still saveable.
      </div>
    );
  }

  const approvalCount = useMemo(() => (team.approval_queue || []).length, [team]);
  const auditPreview = useMemo(() => {
    const retentionDays = Number(settingsState.audit_settings?.retention_days || 90);
    const reviewable = Math.max((auditLogs || []).length - Math.floor(retentionDays / 45), 0);
    return {
      retained: reviewable,
      archived: Math.max((auditLogs || []).length - reviewable, 0),
      maskingPolicy: settingsState.audit_settings?.masking_policy || "partial",
    };
  }, [auditLogs, settingsState.audit_settings]);

  async function saveProfile() {
    try {
      const nextTheme = settingsState.theme_mode || profile.theme || "dark";
      const payload = await updateSettingsProfile(token, {
        ...profile,
        theme: nextTheme,
        email_alerts_enabled: settingsState.email_alerts_enabled,
        sms_alerts_enabled: settingsState.sms_alerts_enabled,
        alert_preferences: settingsState.alert_preferences,
        alert_delivery: settingsState.alert_delivery,
      });
      applyTheme(nextTheme);
      try {
        localStorage.setItem("paywatch_default_filters", JSON.stringify(profile.default_filters || {}));
        localStorage.setItem("paywatch_table_density", profile.table_density || "comfortable");
      } catch (error) {
        // ignore localStorage errors
      }
      setProfile((current) => ({ ...current, ...(payload.profile || {}), theme: nextTheme }));
      setSettingsState((current) => ({
        ...current,
        theme_mode: payload.preferences?.theme || payload.profile?.theme || nextTheme,
        theme: payload.preferences?.theme || payload.profile?.theme || nextTheme,
        email_alerts_enabled: payload.preferences?.email_alerts_enabled ?? payload.profile?.email_alerts_enabled ?? current.email_alerts_enabled,
        sms_alerts_enabled: payload.preferences?.sms_alerts_enabled ?? payload.profile?.sms_alerts_enabled ?? current.sms_alerts_enabled,
        alert_preferences: payload.preferences?.alert_preferences || payload.profile?.alert_preferences || current.alert_preferences,
        alert_delivery: payload.preferences?.alert_delivery || payload.profile?.alert_delivery || current.alert_delivery,
      }));
      await loadPage();
      setStatus("Profile and alert delivery preferences saved.");
      pushToast({
        title: "Profile updated",
        message: "Personal settings and alert delivery preferences were saved.",
        tone: "success",
      });
    } catch (error) {
      setStatus(error.message || "Unable to save profile");
    }
  }

  async function savePlatformSettings() {
    try {
      const payload = await updateSettings(token, settingsState);
      const nextTheme = payload.settings?.theme_mode || payload.settings?.theme || settingsState.theme_mode;
      applyTheme(nextTheme);
      setSettingsState((current) => ({
        ...current,
        ...(payload.settings || {}),
        theme_mode: nextTheme,
        theme: nextTheme,
      }));
      await loadPage();
      setStatus("Platform settings updated.");
      pushToast({
        title: "Platform settings saved",
        message: "Theme, alerts, models, feature flags, and audit controls were updated.",
        tone: "success",
      });
      refreshAll();
    } catch (error) {
      setStatus(error.message || "Unable to save platform settings");
    }
  }

  async function handleSendTestEmail() {
    setTestEmailBusy(true);
    try {
      const profilePayload = {
        ...profile,
        email_alerts_enabled: settingsState.email_alerts_enabled,
        sms_alerts_enabled: settingsState.sms_alerts_enabled,
        alert_preferences: settingsState.alert_preferences,
        alert_delivery: settingsState.alert_delivery,
      };
      const result = await sendTestEmail(token, profilePayload);
      const detail = result.delivery?.detail || "Test email was processed.";
      setStatus(detail);
      pushToast({
        title: `Email ${String(result.delivery?.status || "processed").toUpperCase()}`,
        message: detail,
        tone: result.delivery?.status === "sent" ? "success" : "warning",
      });
      await loadPage();
    } catch (error) {
      setStatus(error.message || "Unable to send test email");
    } finally {
      setTestEmailBusy(false);
    }
  }

  async function handleApprove(userId, role = "VIEWER") {
    setBusyUser(userId);
    try {
      await approveUser(token, userId, role);
      await loadPage();
      setStatus(`User ${userId} approved.`);
      pushToast({
        title: "User approved",
        message: `User ${userId} is now active in the workspace.`,
        tone: "success",
      });
    } catch (error) {
      setStatus(error.message || "Unable to approve user");
    } finally {
      setBusyUser(null);
    }
  }

  async function handleRoleChange(userId, role) {
    setBusyUser(userId);
    try {
      await updateUserRole(token, userId, role);
      await loadPage();
      setStatus(`User ${userId} role updated.`);
      pushToast({
        title: "Role updated",
        message: `User ${userId} now has ${role} access.`,
        tone: "info",
      });
    } catch (error) {
      setStatus(error.message || "Unable to update role");
    } finally {
      setBusyUser(null);
    }
  }

  async function handleStatusChange(userId, nextStatus) {
    setBusyUser(userId);
    try {
      await updateUserStatus(token, userId, nextStatus);
      await loadPage();
      setStatus(`User ${userId} status updated.`);
      pushToast({
        title: "User status changed",
        message: `User ${userId} is now ${nextStatus}.`,
        tone: "warning",
      });
    } catch (error) {
      setStatus(error.message || "Unable to update status");
    } finally {
      setBusyUser(null);
    }
  }

  async function handlePermissionToggle(member, permissionKey, value) {
    try {
      await updateTeamPermissions(token, member.email, {
        ...(member.permission_override || {}),
        [permissionKey]: value
      });
      await loadPage();
      setStatus(`Updated permissions for ${member.email}.`);
      pushToast({
        title: "Permissions updated",
        message: `Permission matrix saved for ${member.email}.`,
        tone: "info",
      });
    } catch (error) {
      setStatus(error.message || "Unable to update permissions");
    }
  }

  const memberFocus = String(searchParams.get("member") || "").toLowerCase();
  const visibleMembers = memberFocus
    ? (team.members || []).filter((member) => String(member.email || "").toLowerCase().includes(memberFocus))
    : (team.members || []);

  if (pageLoading && !environment) {
    return (
      <div className="page-grid settings-page-advanced">
        <section className="panel">
          <SkeletonBlock lines={8} />
        </section>
        <section className="panel">
          <SkeletonBlock lines={8} />
        </section>
      </div>
    );
  }

  return (
    <div className="page-grid settings-page-advanced">
      {status ? <div className="status-text">{status}</div> : null}

      <section className="content-grid analytics-grid-wide">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Workspace Defaults</h3>
              <p>Separate personal preferences from team presets, dashboard defaults, mobile density, and cross-page tools.</p>
            </div>
          </div>
          <div className="settings-form">
            <label>Dashboard Preset<select value={profile.default_filters?.preset || "analyst"} onChange={(event) => setProfile((current) => ({ ...current, default_filters: { ...(current.default_filters || {}), preset: event.target.value } }))}><option value="analyst">Analyst</option><option value="supervisor">Supervisor</option><option value="executive">Executive</option></select></label>
            <label>Default Chart Interval<select value={settingsState.reporting?.default_chart_interval || "hourly"} onChange={(event) => setSettingsState((current) => ({ ...current, reporting: { ...(current.reporting || {}), default_chart_interval: event.target.value } }))}><option value="15m">15 minutes</option><option value="hourly">Hourly</option><option value="daily">Daily</option></select></label>
            <label>Productivity Default<select value={settingsState.onboarding?.productivity_default || "sla-first"} onChange={(event) => setSettingsState((current) => ({ ...current, onboarding: { ...(current.onboarding || {}), productivity_default: event.target.value } }))}><option value="sla-first">SLA first</option><option value="highest-risk">Highest risk</option><option value="newest">Newest</option><option value="likely-false-positive">False positive review</option></select></label>
            <label className="toggle-row"><span>Global Bookmarks</span><input type="checkbox" checked={Boolean(settingsState.reporting?.casebook_workspace)} onChange={(event) => setSettingsState((current) => ({ ...current, reporting: { ...(current.reporting || {}), casebook_workspace: event.target.checked } }))} /></label>
            <label className="toggle-row"><span>Universal AI Summary Panel</span><input type="checkbox" checked={Boolean(settingsState.reporting?.ai_summary_panel)} onChange={(event) => setSettingsState((current) => ({ ...current, reporting: { ...(current.reporting || {}), ai_summary_panel: event.target.checked } }))} /></label>
            <label className="toggle-row"><span>Guided Onboarding</span><input type="checkbox" checked={Boolean(settingsState.onboarding?.guided_mode)} onChange={(event) => setSettingsState((current) => ({ ...current, onboarding: { ...(current.onboarding || {}), guided_mode: event.target.checked } }))} /></label>
            <label className="toggle-row"><span>Collaboration Presence</span><input type="checkbox" checked={Boolean(settingsState.onboarding?.collaboration_presence)} onChange={(event) => setSettingsState((current) => ({ ...current, onboarding: { ...(current.onboarding || {}), collaboration_presence: event.target.checked } }))} /></label>
            <button className="primary-button" type="button" onClick={saveProfile}>Save Personal Defaults</button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Security And Export Policy</h3>
              <p>Access-controlled exports, retention, session timeout, allowlists, and report scheduling.</p>
            </div>
          </div>
          {renderPlatformReadonlyNote()}
          <fieldset className="settings-form settings-fieldset" disabled={!canManagePlatform}>
            <label>Session Timeout Minutes<input type="number" min="5" value={settingsState.access_policy?.session_timeout_minutes || 45} onChange={(event) => setSettingsState((current) => ({ ...current, access_policy: { ...(current.access_policy || {}), session_timeout_minutes: Number(event.target.value) } }))} /></label>
            <label>IP Allowlist<input value={settingsState.access_policy?.ip_allowlist || ""} onChange={(event) => setSettingsState((current) => ({ ...current, access_policy: { ...(current.access_policy || {}), ip_allowlist: event.target.value } }))} /></label>
            <label>Download Permission<select value={settingsState.access_policy?.download_permission || "reviewers"} onChange={(event) => setSettingsState((current) => ({ ...current, access_policy: { ...(current.access_policy || {}), download_permission: event.target.value } }))}><option value="admin_only">Admin only</option><option value="reviewers">Reviewers</option><option value="analysts">Analysts</option></select></label>
            <label>Evidence Retention Days<input type="number" min="30" value={settingsState.access_policy?.evidence_retention_days || 365} onChange={(event) => setSettingsState((current) => ({ ...current, access_policy: { ...(current.access_policy || {}), evidence_retention_days: Number(event.target.value) } }))} /></label>
            <label>Report Schedule<select value={settingsState.reporting?.schedule || "weekly"} onChange={(event) => setSettingsState((current) => ({ ...current, reporting: { ...(current.reporting || {}), schedule: event.target.value } }))}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
            <label>Report Branding<select value={settingsState.reporting?.brand_template || "executive"} onChange={(event) => setSettingsState((current) => ({ ...current, reporting: { ...(current.reporting || {}), brand_template: event.target.value } }))}><option value="executive">Executive</option><option value="casebook">Casebook</option><option value="compliance">Compliance</option></select></label>
            {renderPlatformSaveButton("Save Security And Export Settings")}
          </fieldset>
        </div>
      </section>

      <section className="content-grid analytics-grid-wide">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Integrations And Keys</h3>
              <p>API keys, webhook retry policy, Slack, Teams, email, and SMS channel controls.</p>
            </div>
          </div>
          {renderPlatformReadonlyNote()}
          <fieldset className="settings-form settings-fieldset" disabled={!canManagePlatform}>
            {(settingsState.api_keys || []).map((keyItem, index) => (
              <article key={keyItem.id || index} className="workspace-card">
                <label>Key Name<input value={keyItem.name || ""} onChange={(event) => setSettingsState((current) => ({ ...current, api_keys: (current.api_keys || []).map((item, innerIndex) => innerIndex === index ? { ...item, name: event.target.value } : item) }))} /></label>
                <label>Status<select value={keyItem.status || "active"} onChange={(event) => setSettingsState((current) => ({ ...current, api_keys: (current.api_keys || []).map((item, innerIndex) => innerIndex === index ? { ...item, status: event.target.value } : item) }))}><option value="active">active</option><option value="rotating">rotating</option><option value="disabled">disabled</option></select></label>
              </article>
            ))}
            {(settingsState.integrations?.webhooks || []).map((hook, index) => (
              <article key={hook.id || index} className="workspace-card">
                <label>Webhook URL<input value={hook.url || ""} onChange={(event) => setSettingsState((current) => ({ ...current, integrations: { ...(current.integrations || {}), webhooks: (current.integrations?.webhooks || []).map((item, innerIndex) => innerIndex === index ? { ...item, url: event.target.value } : item) } }))} /></label>
                <label>Retry Policy<input value={hook.retry_policy || ""} onChange={(event) => setSettingsState((current) => ({ ...current, integrations: { ...(current.integrations || {}), webhooks: (current.integrations?.webhooks || []).map((item, innerIndex) => innerIndex === index ? { ...item, retry_policy: event.target.value } : item) } }))} /></label>
                <label className="toggle-row"><span>Enabled</span><input type="checkbox" checked={Boolean(hook.enabled)} onChange={(event) => setSettingsState((current) => ({ ...current, integrations: { ...(current.integrations || {}), webhooks: (current.integrations?.webhooks || []).map((item, innerIndex) => innerIndex === index ? { ...item, enabled: event.target.checked } : item) } }))} /></label>
              </article>
            ))}
            <div className="reason-chip-row">
              {["email", "sms", "slack", "teams"].map((channel) => (
                <label key={channel} className="toggle-row">
                  <span>{channel}</span>
                  <input type="checkbox" checked={Boolean(settingsState.integrations?.channels?.[channel])} onChange={(event) => setSettingsState((current) => ({ ...current, integrations: { ...(current.integrations || {}), channels: { ...(current.integrations?.channels || {}), [channel]: event.target.checked } } }))} />
                </label>
              ))}
            </div>
            {renderPlatformSaveButton("Save Integrations")}
          </fieldset>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Templates And Compliance</h3>
              <p>Playbooks, case notes, onboarding, backups, and evidence retention options.</p>
            </div>
          </div>
          {renderPlatformReadonlyNote()}
          <fieldset className="settings-form settings-fieldset" disabled={!canManagePlatform}>
            {(settingsState.alert_workflow?.case_note_templates || []).map((template, index) => (
              <article key={template.id || index} className="workspace-card">
                <label>Note Template<input value={template.title || ""} onChange={(event) => setSettingsState((current) => ({ ...current, alert_workflow: { ...(current.alert_workflow || {}), case_note_templates: (current.alert_workflow?.case_note_templates || []).map((item, innerIndex) => innerIndex === index ? { ...item, title: event.target.value } : item) } }))} /></label>
                <label>Body<input value={template.body || ""} onChange={(event) => setSettingsState((current) => ({ ...current, alert_workflow: { ...(current.alert_workflow || {}), case_note_templates: (current.alert_workflow?.case_note_templates || []).map((item, innerIndex) => innerIndex === index ? { ...item, body: event.target.value } : item) } }))} /></label>
              </article>
            ))}
            {(settingsState.alert_workflow?.playbooks || []).map((playbook, index) => (
              <article key={playbook.alert_type || index} className="workspace-card">
                <label>Alert Type<input value={playbook.alert_type || ""} onChange={(event) => setSettingsState((current) => ({ ...current, alert_workflow: { ...(current.alert_workflow || {}), playbooks: (current.alert_workflow?.playbooks || []).map((item, innerIndex) => innerIndex === index ? { ...item, alert_type: event.target.value } : item) } }))} /></label>
                <label>Playbook Title<input value={playbook.title || ""} onChange={(event) => setSettingsState((current) => ({ ...current, alert_workflow: { ...(current.alert_workflow || {}), playbooks: (current.alert_workflow?.playbooks || []).map((item, innerIndex) => innerIndex === index ? { ...item, title: event.target.value } : item) } }))} /></label>
              </article>
            ))}
            <label>Compliance Mode<select value={settingsState.retention?.compliance_mode || "standard"} onChange={(event) => setSettingsState((current) => ({ ...current, retention: { ...(current.retention || {}), compliance_mode: event.target.value } }))}><option value="standard">Standard</option><option value="strict">Strict</option><option value="regulated">Regulated</option></select></label>
            <button className="secondary-button" type="button" onClick={() => setSettingsState((current) => ({ ...current, backup_snapshot: true }))}>Prepare Backup Snapshot</button>
            {renderPlatformSaveButton("Save Templates And Compliance")}
          </fieldset>
        </div>
      </section>

      <section className="content-grid analytics-grid-wide">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>User Profile</h3>
              <p>Avatar, display name, contact info, timezone, language, and personal workflow defaults.</p>
            </div>
          </div>
          <div className="settings-form">
            <label>Avatar URL<input value={profile.avatar_url || ""} onChange={(event) => setProfile((current) => ({ ...current, avatar_url: event.target.value }))} /></label>
            <label>Display Name<input value={profile.display_name || ""} onChange={(event) => setProfile((current) => ({ ...current, display_name: event.target.value }))} /></label>
            <label>Contact Email<input value={profile.contact_email || email || ""} onChange={(event) => setProfile((current) => ({ ...current, contact_email: event.target.value }))} /></label>
            <label>Contact Phone<input value={profile.contact_phone || ""} onChange={(event) => setProfile((current) => ({ ...current, contact_phone: event.target.value }))} /></label>
            <label>Timezone<input value={profile.timezone || ""} onChange={(event) => setProfile((current) => ({ ...current, timezone: event.target.value }))} /></label>
            <label>Language<input value={profile.language || "en"} onChange={(event) => setProfile((current) => ({ ...current, language: event.target.value }))} /></label>
            <label>Theme<select value={themePreference} onChange={(event) => {
              const nextTheme = event.target.value;
              setProfile((current) => ({ ...current, theme: nextTheme }));
              setSettingsState((current) => ({ ...current, theme_mode: nextTheme, theme: nextTheme }));
            }}><option value="dark">Dark</option><option value="light">Light</option><option value="high-contrast">High Contrast</option></select></label>
            <label>Default Risk Filter<select value={profile.default_filters?.risk_level || "ALL"} onChange={(event) => setProfile((current) => ({ ...current, default_filters: { ...(current.default_filters || {}), risk_level: event.target.value } }))}><option value="ALL">All</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
            <label>Table Density<select value={profile.table_density || "comfortable"} onChange={(event) => setProfile((current) => ({ ...current, table_density: event.target.value }))}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label>
            <label>Notification Style<select value={profile.notification_style || "detailed"} onChange={(event) => setProfile((current) => ({ ...current, notification_style: event.target.value }))}><option value="minimal">Minimal</option><option value="detailed">Detailed</option><option value="digest">Digest</option></select></label>
            <button className="primary-button" type="button" onClick={saveProfile}>Save Profile Preferences</button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Theme And Alert Preferences</h3>
              <p>Theme control, alert channels, severity routing, and quiet hours.</p>
            </div>
          </div>
          <div className="settings-form">
            <label>Theme Mode<select value={settingsState.theme_mode || "dark"} onChange={(event) => setSettingsState((current) => ({ ...current, theme_mode: event.target.value, theme: event.target.value }))}><option value="dark">Dark</option><option value="light">Light</option><option value="high-contrast">High Contrast</option></select></label>
            <label className="toggle-row"><span>Email Alerts</span><input type="checkbox" checked={Boolean(settingsState.alert_preferences?.channels?.email)} onChange={(event) => setSettingsState((current) => ({ ...current, alert_preferences: { ...(current.alert_preferences || {}), channels: { ...(current.alert_preferences?.channels || {}), email: event.target.checked } }, email_alerts_enabled: event.target.checked }))} /></label>
            <label className="toggle-row"><span>SMS Alerts</span><input type="checkbox" checked={Boolean(settingsState.alert_preferences?.channels?.sms)} onChange={(event) => setSettingsState((current) => ({ ...current, alert_preferences: { ...(current.alert_preferences || {}), channels: { ...(current.alert_preferences?.channels || {}), sms: event.target.checked } }, sms_alerts_enabled: event.target.checked }))} /></label>
            <label className="toggle-row"><span>Webhook Alerts</span><input type="checkbox" checked={Boolean(settingsState.alert_preferences?.channels?.webhook)} onChange={(event) => setSettingsState((current) => ({ ...current, alert_preferences: { ...(current.alert_preferences || {}), channels: { ...(current.alert_preferences?.channels || {}), webhook: event.target.checked } } }))} /></label>
            <label>Quiet Hours Start<input type="time" value={settingsState.alert_preferences?.quiet_hours?.start || "22:00"} onChange={(event) => setSettingsState((current) => ({ ...current, alert_preferences: { ...(current.alert_preferences || {}), quiet_hours: { ...(current.alert_preferences?.quiet_hours || {}), start: event.target.value } } }))} /></label>
            <label>Quiet Hours End<input type="time" value={settingsState.alert_preferences?.quiet_hours?.end || "06:00"} onChange={(event) => setSettingsState((current) => ({ ...current, alert_preferences: { ...(current.alert_preferences || {}), quiet_hours: { ...(current.alert_preferences?.quiet_hours || {}), end: event.target.value } } }))} /></label>
            <div className="reason-chip-row">
              {["low", "medium", "high", "critical"].map((level) => (
                <label key={level} className="toggle-row">
                  <span>{level}</span>
                  <input type="checkbox" checked={Boolean(settingsState.alert_preferences?.severity?.[level])} onChange={(event) => setSettingsState((current) => ({ ...current, alert_preferences: { ...(current.alert_preferences || {}), severity: { ...(current.alert_preferences?.severity || {}), [level]: event.target.checked } } }))} />
                </label>
              ))}
            </div>
            <label>Alert Recipient Email<input value={settingsState.alert_delivery?.email_recipient || profile.contact_email || email || ""} onChange={(event) => setSettingsState((current) => ({ ...current, alert_delivery: { ...(current.alert_delivery || {}), email_recipient: event.target.value } }))} /></label>
            <label>Alert Sender Email<input value={settingsState.alert_delivery?.email_sender || "alerts@paywatch.local"} onChange={(event) => setSettingsState((current) => ({ ...current, alert_delivery: { ...(current.alert_delivery || {}), email_sender: event.target.value } }))} /></label>
            <label>SMTP Host<input placeholder="smtp.gmail.com or localhost" value={settingsState.alert_delivery?.smtp_host || ""} onChange={(event) => setSettingsState((current) => ({ ...current, alert_delivery: { ...(current.alert_delivery || {}), smtp_host: event.target.value } }))} /></label>
            <label>SMTP Port<input type="number" min="1" max="65535" value={settingsState.alert_delivery?.smtp_port || 1025} onChange={(event) => setSettingsState((current) => ({ ...current, alert_delivery: { ...(current.alert_delivery || {}), smtp_port: Number(event.target.value) || 1025 } }))} /></label>
            <label>SMTP Username<input value={settingsState.alert_delivery?.smtp_username || ""} onChange={(event) => setSettingsState((current) => ({ ...current, alert_delivery: { ...(current.alert_delivery || {}), smtp_username: event.target.value } }))} /></label>
            <label>SMTP Password<input type="password" value={settingsState.alert_delivery?.smtp_password || ""} onChange={(event) => setSettingsState((current) => ({ ...current, alert_delivery: { ...(current.alert_delivery || {}), smtp_password: event.target.value } }))} /></label>
            <label className="toggle-row"><span>Use STARTTLS</span><input type="checkbox" checked={Boolean(settingsState.alert_delivery?.starttls)} onChange={(event) => setSettingsState((current) => ({ ...current, alert_delivery: { ...(current.alert_delivery || {}), starttls: event.target.checked } }))} /></label>
            <label className="toggle-row"><span>Require SMTP Auth</span><input type="checkbox" checked={Boolean(settingsState.alert_delivery?.require_auth)} onChange={(event) => setSettingsState((current) => ({ ...current, alert_delivery: { ...(current.alert_delivery || {}), require_auth: event.target.checked } }))} /></label>
            <p className="smart-summary-text">
              High-risk alerts email the configured recipient. If SMTP host is left blank, local runs will try localhost or Mailpit automatically; for real inbox delivery, set your SMTP server and credentials here.
            </p>
            <div className="reason-chip-row">
              <button className="primary-button" type="button" onClick={saveProfile}>Save Alert Preferences</button>
              <button className="secondary-button" type="button" onClick={handleSendTestEmail} disabled={testEmailBusy}>
                {testEmailBusy ? "Sending Test Email..." : "Send Test Email"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid analytics-grid-wide">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Model Settings And Feature Flags</h3>
              <p>Thresholds, active model policy, fallback behavior, explanation depth, and experimental layers.</p>
            </div>
          </div>
          {renderPlatformReadonlyNote()}
          <fieldset className="settings-form settings-fieldset" disabled={!canManagePlatform}>
            <label>High Threshold<input type="range" min="0.5" max="0.99" step="0.01" value={settingsState.fraud_threshold_high || 0.8} onChange={(event) => setSettingsState((current) => ({ ...current, fraud_threshold_high: Number(event.target.value) }))} /></label>
            <label>Medium Threshold<input type="range" min="0.2" max="0.8" step="0.01" value={settingsState.fraud_threshold_medium || 0.55} onChange={(event) => setSettingsState((current) => ({ ...current, fraud_threshold_medium: Number(event.target.value) }))} /></label>
            <label>Selected Model<select value={settingsState.model_settings?.selected_model || "ensemble"} onChange={(event) => setSettingsState((current) => ({ ...current, model_settings: { ...(current.model_settings || {}), selected_model: event.target.value } }))}><option value="ensemble">Ensemble</option><option value="primary">Primary</option><option value="anomaly">Anomaly</option><option value="graph">Graph</option><option value="behavior">Behavior</option></select></label>
            <label>Fallback Policy<select value={settingsState.model_settings?.fallback_policy || "graceful"} onChange={(event) => setSettingsState((current) => ({ ...current, model_settings: { ...(current.model_settings || {}), fallback_policy: event.target.value } }))}><option value="graceful">Graceful</option><option value="strict">Strict</option><option value="primary_only">Primary Only</option></select></label>
            <label>Explanation Depth<select value={settingsState.model_settings?.explanation_depth || "standard"} onChange={(event) => setSettingsState((current) => ({ ...current, model_settings: { ...(current.model_settings || {}), explanation_depth: event.target.value } }))}><option value="compact">Compact</option><option value="standard">Standard</option><option value="deep">Deep</option></select></label>
            <label>Currency<input value={settingsState.currency || "USD"} onChange={(event) => setSettingsState((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></label>
            <div className="reason-chip-row">
              {Object.entries(settingsState.feature_flags || {}).map(([key, value]) => (
                <label key={key} className="toggle-row"><span>{key}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => setSettingsState((current) => ({ ...current, feature_flags: { ...(current.feature_flags || {}), [key]: event.target.checked } }))} /></label>
              ))}
            </div>
            {renderPlatformSaveButton()}
          </fieldset>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Environment Status And Audit</h3>
              <p>Active endpoints, version, secrets health, service availability, retention, masking, and review logs.</p>
            </div>
          </div>
          <div className="details-grid">
            <div><dt>Version</dt><dd>{environment?.version || "2.0"}</dd></div>
            <div><dt>API</dt><dd>{environment?.active_endpoints?.api || "n/a"}</dd></div>
            <div><dt>Frontend</dt><dd>{environment?.active_endpoints?.frontend || "n/a"}</dd></div>
            <div><dt>Docs</dt><dd>{environment?.active_endpoints?.docs || "n/a"}</dd></div>
          </div>
          <div className="insight-grid" style={{ marginTop: "16px" }}>
            {Object.entries(environment?.service_availability || {}).map(([key, value]) => (
              <article key={key} className="insight-card">
                <p>{key}</p>
                <strong>{typeof value === "object" ? JSON.stringify(value).slice(0, 36) : String(value)}</strong>
                <span>Live service availability</span>
              </article>
            ))}
          </div>
          <div className="reason-chip-row">
            {Object.entries(environment?.secrets_health || {}).map(([key, value]) => (
              <span key={key} className="reason-chip">
                {key}: {value ? "configured" : "missing"}
              </span>
            ))}
          </div>
          <div className="details-grid" style={{ marginTop: "16px" }}>
            <div><dt>Alert Recipient</dt><dd>{environment?.alert_delivery?.recipient || settingsState.alert_delivery?.email_recipient || profile.contact_email || "n/a"}</dd></div>
            <div><dt>Alert Sender</dt><dd>{environment?.alert_delivery?.sender || settingsState.alert_delivery?.email_sender || "alerts@paywatch.local"}</dd></div>
            <div><dt>SMTP Host</dt><dd>{environment?.alert_delivery?.smtp_host || settingsState.alert_delivery?.smtp_host || "auto-detect"}</dd></div>
            <div><dt>SMTP Port</dt><dd>{environment?.alert_delivery?.smtp_port || settingsState.alert_delivery?.smtp_port || 1025}</dd></div>
          </div>
          {renderPlatformReadonlyNote()}
          <fieldset className="settings-form settings-fieldset" disabled={!canManagePlatform}>
            <label>Retention Days<input type="number" min="7" value={settingsState.audit_settings?.retention_days || 90} onChange={(event) => setSettingsState((current) => ({ ...current, audit_settings: { ...(current.audit_settings || {}), retention_days: Number(event.target.value) } }))} /></label>
            <label>Masking Policy<select value={settingsState.audit_settings?.masking_policy || "partial"} onChange={(event) => setSettingsState((current) => ({ ...current, audit_settings: { ...(current.audit_settings || {}), masking_policy: event.target.value } }))}><option value="none">None</option><option value="partial">Partial</option><option value="strict">Strict</option></select></label>
            <label>Export Policy<select value={settingsState.audit_settings?.export_policy || "admin_only"} onChange={(event) => setSettingsState((current) => ({ ...current, audit_settings: { ...(current.audit_settings || {}), export_policy: event.target.value } }))}><option value="admin_only">Admin Only</option><option value="reviewers">Reviewers</option><option value="open">Open</option></select></label>
            <label className="toggle-row"><span>Review Logs Enabled</span><input type="checkbox" checked={Boolean(settingsState.audit_settings?.review_logs)} onChange={(event) => setSettingsState((current) => ({ ...current, audit_settings: { ...(current.audit_settings || {}), review_logs: event.target.checked } }))} /></label>
          </fieldset>
          <div className="alert-list">
            {(auditLogs || []).slice(0, 8).map((log, index) => (
              <article key={`${log.timestamp}-${index}`} className="alert-card">
                <div className="alert-card-top">
                  <strong>{log.title || log.event || log.category || "Audit Event"}</strong>
                  <span>{formatTimestamp(log.timestamp)}</span>
                </div>
                <p>{log.description || log.message || "No description"}</p>
                <span>{log.actor || "system"} · {log.severity || "info"}</span>
              </article>
            ))}
          </div>
          <div className="panel-subsection">
            <div className="panel-header">
              <div>
                <h4>Observability Logs Dashboard</h4>
                <p>Structured request, fraud decision, and error events from the live API.</p>
              </div>
            </div>
            <div className="details-grid">
              <div><dt>Log File</dt><dd>{observabilityMeta.log_file || "logs/structured_events.jsonl"}</dd></div>
              <div><dt>Prometheus</dt><dd>{observabilityMeta.prometheus_enabled ? "enabled" : "disabled"}</dd></div>
              <div><dt>Grafana</dt><dd>{observabilityMeta.grafana_ready ? "ready" : "disabled"}</dd></div>
            </div>
            <div className="alert-list">
              {(observabilityLogs || []).slice(0, 6).map((event, index) => (
                <article key={`${event.timestamp || index}-obs`} className="alert-card">
                  <div className="alert-card-top">
                    <strong>{event.event_type || event.type || "event"}</strong>
                    <span>{formatTimestamp(event.timestamp)}</span>
                  </div>
                  <p>{event.path || event.detail || event.message || "Telemetry event recorded."}</p>
                  <span>{event.method || event.severity || "info"} · {event.status_code || event.risk_level || event.model_version || "signal"}</span>
                </article>
              ))}
              {!observabilityLogs?.length ? (
                <div className="empty-state compact-empty">No structured events yet. Generate traffic to see live telemetry.</div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid analytics-grid-wide">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Tenant / Org Branding</h3>
              <p>Workspace name, tagline, accent colors, and logo presentation.</p>
            </div>
          </div>
          {renderPlatformReadonlyNote()}
          <fieldset className="settings-form settings-fieldset" disabled={!canManagePlatform}>
            <label>Org Name<input value={settingsState.tenant_branding?.org_name || ""} onChange={(event) => setSettingsState((current) => ({ ...current, tenant_branding: { ...(current.tenant_branding || {}), org_name: event.target.value } }))} /></label>
            <label>Workspace Title<input value={settingsState.tenant_branding?.workspace_title || ""} onChange={(event) => setSettingsState((current) => ({ ...current, tenant_branding: { ...(current.tenant_branding || {}), workspace_title: event.target.value } }))} /></label>
            <label>Tagline<input value={settingsState.tenant_branding?.tagline || ""} onChange={(event) => setSettingsState((current) => ({ ...current, tenant_branding: { ...(current.tenant_branding || {}), tagline: event.target.value } }))} /></label>
            <label>Primary Accent<input value={settingsState.tenant_branding?.accent_primary || ""} onChange={(event) => setSettingsState((current) => ({ ...current, tenant_branding: { ...(current.tenant_branding || {}), accent_primary: event.target.value } }))} /></label>
            <label>Secondary Accent<input value={settingsState.tenant_branding?.accent_secondary || ""} onChange={(event) => setSettingsState((current) => ({ ...current, tenant_branding: { ...(current.tenant_branding || {}), accent_secondary: event.target.value } }))} /></label>
            <label>Logo Mode<select value={settingsState.tenant_branding?.logo_mode || "3d-mark"} onChange={(event) => setSettingsState((current) => ({ ...current, tenant_branding: { ...(current.tenant_branding || {}), logo_mode: event.target.value } }))}><option value="3d-mark">3D Mark</option><option value="flat-mark">Flat Mark</option><option value="wordmark">Wordmark</option></select></label>
            {renderPlatformSaveButton("Save Branding Settings")}
          </fieldset>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Notification Rules Builder</h3>
              <p>Per-channel routing rules by severity and fraud conditions.</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={!canManagePlatform}
              onClick={() =>
                setSettingsState((current) => ({
                  ...current,
                  notification_rules: [...(current.notification_rules || []), createNotificationRule()],
                }))
              }
            >
              Add Rule
            </button>
          </div>
          {renderPlatformReadonlyNote()}
          <fieldset className="workspace-list settings-fieldset" disabled={!canManagePlatform}>
            {(settingsState.notification_rules || []).map((rule, index) => (
              <article key={rule.id || index} className="workspace-card">
                <div className="settings-form">
                  <label>Rule Name<input value={rule.name || ""} onChange={(event) => setSettingsState((current) => ({ ...current, notification_rules: (current.notification_rules || []).map((item, innerIndex) => innerIndex === index ? { ...item, name: event.target.value } : item) }))} /></label>
                  <label>Channel<select value={rule.channel || "webhook"} onChange={(event) => setSettingsState((current) => ({ ...current, notification_rules: (current.notification_rules || []).map((item, innerIndex) => innerIndex === index ? { ...item, channel: event.target.value } : item) }))}><option value="email">email</option><option value="sms">sms</option><option value="webhook">webhook</option></select></label>
                  <label>Severity<select value={rule.severity || "high"} onChange={(event) => setSettingsState((current) => ({ ...current, notification_rules: (current.notification_rules || []).map((item, innerIndex) => innerIndex === index ? { ...item, severity: event.target.value } : item) }))}><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option></select></label>
                  <label>Condition<input value={rule.condition || ""} onChange={(event) => setSettingsState((current) => ({ ...current, notification_rules: (current.notification_rules || []).map((item, innerIndex) => innerIndex === index ? { ...item, condition: event.target.value } : item) }))} /></label>
                  <label className="toggle-row"><span>Enabled</span><input type="checkbox" checked={Boolean(rule.enabled)} onChange={(event) => setSettingsState((current) => ({ ...current, notification_rules: (current.notification_rules || []).map((item, innerIndex) => innerIndex === index ? { ...item, enabled: event.target.checked } : item) }))} /></label>
                  <button className="ghost-button" type="button" onClick={() => setSettingsState((current) => ({ ...current, notification_rules: (current.notification_rules || []).filter((_, innerIndex) => innerIndex !== index) }))}>Remove Rule</button>
                </div>
              </article>
            ))}
            {!(settingsState.notification_rules || []).length ? <div className="empty-state">Notification rules will appear here once configured.</div> : null}
            {renderPlatformSaveButton("Save Notification Rules")}
          </fieldset>
        </div>
      </section>

      <section className="content-grid analytics-grid-wide">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Audit Retention Preview And Policy Simulator</h3>
              <p>See how retention and masking policies affect available audit evidence.</p>
            </div>
          </div>
          <div className="insight-grid">
            <article className="insight-card"><p>Retained</p><strong>{auditPreview.retained}</strong><span>audit items kept in active review</span></article>
            <article className="insight-card"><p>Archived</p><strong>{auditPreview.archived}</strong><span>items moved out of the hot review window</span></article>
            <article className="insight-card"><p>Masking Policy</p><strong>{String(auditPreview.maskingPolicy).toUpperCase()}</strong><span>applied to exported or reviewed evidence</span></article>
          </div>
          <p className="smart-summary-text">With {settingsState.audit_settings?.retention_days || 90} retention days and {settingsState.audit_settings?.masking_policy || "partial"} masking, the current policy keeps {auditPreview.retained} entries active for analysts while archiving {auditPreview.archived} older records.</p>
          {renderPlatformReadonlyNote()}
          {renderPlatformSaveButton("Save Audit Policies")}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Model Access And Promotion Controls</h3>
              <p>Approval workflow, activation roles, and environment promotion controls.</p>
            </div>
          </div>
          {renderPlatformReadonlyNote()}
          <fieldset className="settings-form settings-fieldset" disabled={!canManagePlatform}>
            <label className="toggle-row"><span>Approval Required</span><input type="checkbox" checked={Boolean(settingsState.model_access?.approval_required)} onChange={(event) => setSettingsState((current) => ({ ...current, model_access: { ...(current.model_access || {}), approval_required: event.target.checked } }))} /></label>
            <label>Approvers<input value={(settingsState.model_access?.approvers || []).join(", ")} onChange={(event) => setSettingsState((current) => ({ ...current, model_access: { ...(current.model_access || {}), approvers: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } }))} /></label>
            <label>Activation Roles<input value={(settingsState.model_access?.activation_roles || []).join(", ")} onChange={(event) => setSettingsState((current) => ({ ...current, model_access: { ...(current.model_access || {}), activation_roles: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } }))} /></label>
            <label>Current Environment<select value={settingsState.model_access?.current_environment || "production"} onChange={(event) => setSettingsState((current) => ({ ...current, model_access: { ...(current.model_access || {}), current_environment: event.target.value } }))}><option value="staging">staging</option><option value="production">production</option></select></label>
            <label>Promotion Notes<input value={settingsState.model_access?.promotion_notes || ""} onChange={(event) => setSettingsState((current) => ({ ...current, model_access: { ...(current.model_access || {}), promotion_notes: event.target.value } }))} /></label>
          </fieldset>
          <fieldset className="workspace-list settings-fieldset" disabled={!canManagePlatform}>
            {(settingsState.model_access?.promotion_envs || []).map((env, index) => (
              <article key={env.environment || index} className="workspace-card">
                <div className="settings-form">
                  <label>Environment<input value={env.environment || ""} onChange={(event) => setSettingsState((current) => ({ ...current, model_access: { ...(current.model_access || {}), promotion_envs: (current.model_access?.promotion_envs || []).map((item, innerIndex) => innerIndex === index ? { ...item, environment: event.target.value } : item) } }))} /></label>
                  <label className="toggle-row"><span>Enabled</span><input type="checkbox" checked={Boolean(env.enabled)} onChange={(event) => setSettingsState((current) => ({ ...current, model_access: { ...(current.model_access || {}), promotion_envs: (current.model_access?.promotion_envs || []).map((item, innerIndex) => innerIndex === index ? { ...item, enabled: event.target.checked } : item) } }))} /></label>
                  <label className="toggle-row"><span>Requires Approval</span><input type="checkbox" checked={Boolean(env.requires_approval)} onChange={(event) => setSettingsState((current) => ({ ...current, model_access: { ...(current.model_access || {}), promotion_envs: (current.model_access?.promotion_envs || []).map((item, innerIndex) => innerIndex === index ? { ...item, requires_approval: event.target.checked } : item) } }))} /></label>
                </div>
              </article>
            ))}
            {renderPlatformSaveButton("Save Model Access Controls")}
          </fieldset>
        </div>
      </section>

      {permissions.can_manage_users ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Team Management And Permissions Matrix</h3>
              <p>{approvalCount} pending approvals · activation, deactivation, role review, and per-permission control.</p>
            </div>
          </div>
          <div className="content-grid analytics-grid-wide">
            <div>
              <h4>Approval Queue</h4>
              <div className="alert-list">
                {(team.approval_queue || []).map((member) => (
                  <article key={member.id} className="alert-card">
                    <div className="alert-card-top"><strong>{member.display_name || member.name}</strong><span>{member.status}</span></div>
                    <p>{member.email}</p>
                    <div className="inline-form">
                      <button className="primary-button" type="button" onClick={() => handleApprove(member.id, member.role || "VIEWER")} disabled={busyUser === member.id}>Approve</button>
                      <button className="secondary-button" type="button" onClick={() => handleStatusChange(member.id, "DISABLED")} disabled={busyUser === member.id}>Disable</button>
                    </div>
                  </article>
                ))}
                {!(team.approval_queue || []).length ? <div className="empty-state">No pending approvals.</div> : null}
              </div>
            </div>
            <div>
              <h4>Team Matrix</h4>
              <div className="team-matrix-grid">
                {visibleMembers.map((member) => (
                  <article key={member.id} className="workspace-card">
                    <div className="alert-card-top"><strong>{member.display_name || member.name}</strong><span>{member.status}</span></div>
                    <p>{member.email}</p>
                    <div className="inline-form">
                      <select value={member.role} onChange={(event) => handleRoleChange(member.id, event.target.value)}>
                        <option value="VIEWER">Viewer</option>
                        <option value="ANALYST">Analyst</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <button className="secondary-button" type="button" onClick={() => handleStatusChange(member.id, member.status === "ACTIVE" ? "DISABLED" : "ACTIVE")} disabled={busyUser === member.id}>
                        {member.status === "ACTIVE" ? "Disable" : "Activate"}
                      </button>
                    </div>
                    <div className="permission-matrix-grid">
                      {(team.permission_columns || []).map((permissionKey) => (
                        <label key={permissionKey} className="toggle-row">
                          <span>{permissionKey}</span>
                          <input type="checkbox" checked={Boolean(member.permission_override?.[permissionKey] ?? member.permissions?.[permissionKey])} onChange={(event) => handlePermissionToggle(member, permissionKey, event.target.checked)} />
                        </label>
                      ))}
                    </div>
                  </article>
                ))}
                {!visibleMembers.length ? (
                  <EmptyState
                    title="No team members match the current focus"
                    description={memberFocus ? `No users matched "${memberFocus}".` : "Team members will appear here once accounts are registered."}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
