// Standalone Function App that runs the daily-puzzle promotion at
// 00:05 Warsaw. Replaces the GitHub Actions release workflow + Logic
// App pair — see FEATURE.md Feature P Phase 2. Single source of truth:
// every change to this Function App's infra goes through this template
// and `az deployment group create`. No portal click-edits.

@description('Azure region for all resources.')
param location string = 'westeurope'

@description('Name of the existing catalog storage account holding live.json / backlog.json.')
param catalogStorageName string = 'styetanotherquiz'

@description('Time zone the timer trigger fires in. Use Windows TZ identifier.')
param timeZone string = 'Central European Standard Time'

var funcAppName = 'func-yetanotherquiz-release'
// Function-runtime storage. Separate from the catalog blob so churn
// (locks, queues, logs) doesn't share an account with public-read data.
var funcStorageName = 'stfuncyetanotherquiz'
var planName = 'plan-yetanotherquiz-release'
var aiName = 'ai-yetanotherquiz-release'

resource funcStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: funcStorageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: { name: 'Y1', tier: 'Dynamic' }
  properties: { reserved: true }
  kind: 'functionapp'
}

resource ai 'Microsoft.Insights/components@2020-02-02' = {
  name: aiName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Request_Source: 'rest'
  }
}

resource funcApp 'Microsoft.Web/sites@2023-12-01' = {
  name: funcAppName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|22'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${funcStorage.name};AccountKey=${funcStorage.listKeys().keys[0].value};EndpointSuffix=core.windows.net' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'WEBSITE_TIME_ZONE', value: timeZone }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: ai.properties.ConnectionString }
        // Enable Functions v4 programmatic model worker indexing so
        // `app.timer(...)` registrations in src/index.js are picked up.
        { name: 'AzureWebJobsFeatureFlags', value: 'EnableWorkerIndexing' }
        // Let Oryx install the bundled package.json's deps on deploy.
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'ENABLE_ORYX_BUILD', value: 'true' }
      ]
    }
  }
}

resource catalogStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: catalogStorageName
}

// Storage Blob Data Contributor on the catalog account only — managed
// identity lets the Function write live.json + backlog.json without
// any account key being baked into app settings.
resource blobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: catalogStorage
  name: guid(catalogStorage.id, funcApp.id, 'StorageBlobDataContributor')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: funcApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output funcAppName string = funcApp.name
output funcAppPrincipalId string = funcApp.identity.principalId
