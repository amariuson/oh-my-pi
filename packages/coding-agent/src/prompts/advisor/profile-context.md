# Advisor profile

Role: {{role}}
{{#if mode}}
Mode: {{mode}}
{{/if}}
{{#if persistentInstances}}
Persistent advisors: {{persistentInstances}}
{{/if}}
{{#if maxConcurrentInstances}}
Max concurrent hint: {{maxConcurrentInstances}}
{{/if}}
{{#if when}}
Trigger hints: {{./when}}
{{/if}}

{{instructions}}
