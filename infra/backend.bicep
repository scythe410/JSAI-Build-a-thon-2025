param location string
param tags object
param webapiName string
param abbrs object
param appServicePlanName string

// Create an App Service Plan for the webapi
resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {  name: '${abbrs.webServerFarms}${appServicePlanName}'
  location: location
  tags: tags
  sku: {
    name: 'F1'
    tier: 'Free'
  }
  properties: {
    reserved: false
  }
}

// Create an App Service for the webapi
resource webapi 'Microsoft.Web/sites@2022-03-01' = {
  name: '${abbrs.webSitesAppService}${webapiName}'
  location: location
  tags: union(tags, { 'azd-service-name': 'webapi' })
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      alwaysOn: false
      appSettings: [
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
      ]
    }
  }
}

output WEBAPI_URL string = 'https://${webapi.properties.defaultHostName}'
