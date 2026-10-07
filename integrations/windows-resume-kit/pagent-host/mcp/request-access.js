export function pagentExtensionOrigin(extensionId) {
    if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId)) {
        throw new Error('PAGENT_EXTENSION_ID 必须是当前 Pagent Chrome 扩展的 32 位 a-p ID。');
    }
    return `chrome-extension://${extensionId}`;
}
export function mcpHostRequestError(host, origin, port, extensionOrigin) {
    if (host?.toLowerCase() !== `127.0.0.1:${port}` && host?.toLowerCase() !== `localhost:${port}`) {
        return 'Forbidden Host';
    }
    // Native MCP clients omit Origin; browser requests must come from the installed extension.
    if (origin !== undefined && origin !== extensionOrigin)
        return 'Forbidden Origin';
    return undefined;
}
