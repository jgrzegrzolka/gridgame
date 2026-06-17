// Feature Q: observability for the player-facing site.
//
// Single App Insights instance for both the SWA-managed Function App
// (auto-instruments every api/* handler via APPLICATIONINSIGHTS_CONNECTION_STRING)
// and the frontend (JS SDK loaded as a CDN script tag in the shared
// chrome). Cross-correlation via `cloud_RoleName` tagging — "swa-api"
// vs "web" — so failures can be sliced per workload without two
// separate AI bills.
//
// Lives in West Europe (rg-yetanotherquiz's home region) even though
// the SWA itself is in West US 2 after the 2026-06-10 failover.
// AI doesn't need same-region affinity to its emitters.
//
// Workspace-based App Insights (the modern shape — classic AI is
// deprecated). Log Analytics retention is set to the minimum 30 days
// — at our traffic the 5 GB/month free tier is the binding constraint,
// not retention duration.
//
// Deploy:
//   az deployment group create \
//     --resource-group rg-yetanotherquiz \
//     --template-file infra/app-insights.bicep
//
// Then wire to the SWA Function App:
//   az staticwebapp appsettings set -n swa-yetanotherquiz-v3 -g rg-yetanotherquiz \
//     --setting-names APPLICATIONINSIGHTS_CONNECTION_STRING="<from output>"

@description('Azure region — rg-yetanotherquiz default is West Europe.')
param location string = resourceGroup().location

@description('Log Analytics workspace that backs the App Insights instance.')
param workspaceName string = 'law-yetanotherquiz'

@description('Application Insights resource name.')
param appInsightsName string = 'ai-yetanotherquiz'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    // Free tier is 5 GB/month ingestion. At our traffic (240 visits/
    // week, ~100 api calls/day) we sit at ~50 MB/month — room to grow
    // 100× before hitting the cap.
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    // 100% sampling at our current scale. JS SDK has its own client-
    // side sampling knob if traffic ever grows past comfortable.
    SamplingPercentage: 100
    // No public-network restrictions — frontend script tags need to
    // POST telemetry from anywhere.
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output connectionString string = appInsights.properties.ConnectionString
output instrumentationKey string = appInsights.properties.InstrumentationKey
output appInsightsId string = appInsights.id
output workspaceId string = workspace.id
