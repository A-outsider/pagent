export const MCP_HOST_PROTOCOL = 1;
export const MCP_HOST_SERVICE = 'pagent-host';
export const DEFAULT_MCP_HOST_PORT = 17342;
/** 从 DEFAULT_MCP_HOST_PORT 起连续预留的端口数量，MCP 与扩展共用。 */
export const MCP_HOST_PORT_COUNT = 16;
export const MCP_HOST_CONNECTED_MS = 45_000;
export const MCP_HOST_HEARTBEAT_MS = 10_000;
export const MCP_HOST_POLL_MS = 25_000;
export const MCP_HOST_DISCOVER_TIMEOUT_MS = 400;
export function mcpHostPorts(start = DEFAULT_MCP_HOST_PORT, count = MCP_HOST_PORT_COUNT) {
    return Array.from({ length: count }, (_, index) => start + index);
}
export function mcpHostPortRangeLabel(ports = mcpHostPorts()) {
    if (!ports.length)
        return '(empty)';
    const first = ports[0];
    const last = ports[ports.length - 1];
    return first === last ? String(first) : `${first}-${last}`;
}
export function isMcpHostHealth(value) {
    if (!value || typeof value !== 'object')
        return false;
    const item = value;
    return (item.ok === true &&
        item.service === MCP_HOST_SERVICE &&
        item.protocol === MCP_HOST_PROTOCOL &&
        typeof item.name === 'string' &&
        typeof item.port === 'number');
}
export function preferMcpHost(hosts, preferPort) {
    if (!hosts.length)
        return undefined;
    if (preferPort != null) {
        const sticky = hosts.find((host) => host.port === preferPort);
        if (sticky)
            return sticky;
    }
    const direct = hosts.filter((host) => host.directBrowser === true);
    const compatible = direct.length ? direct : hosts;
    const available = compatible.filter((host) => !host.extensionConnected);
    const pool = available.length ? available : compatible;
    return [...pool].sort((left, right) => left.port - right.port)[0];
}
export const MCP_HOST_METHODS = ['list_tabs', 'open_tabs_background', 'dispatch_task', 'get_session', 'boss_start_task', 'boss_get_task', 'boss_cancel_task', 'boss_start_favorites_task', 'boss_get_favorites_preferences', 'boss_set_favorites_greeting', 'boss_list_current_favorites', 'boss_apply_favorite_job', 'boss_get_favorites_task', 'boss_cancel_favorites_task', 'boss_audit_resume_images', 'boss_send_resume_images', 'boss_get_resume_image_scan', 'browser_list_tools', 'browser_call_tool', 'browser_end_task'];
