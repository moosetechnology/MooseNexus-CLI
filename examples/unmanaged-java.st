| importer |
importer := MooseNexusUnmanagedProjectImporter new
  language: 'java';
  dependencies: #( ).

MooseNexusBuildSpec
  coordinates: (MooseNexusCoordinates
    group: 'com.example'
    name: 'demo'
    version: '1.0.0');
  sourceDirectory: '/path/to/source/project' asFileReference;
  projectImporter: importer;
  modelName: 'demo-model'
