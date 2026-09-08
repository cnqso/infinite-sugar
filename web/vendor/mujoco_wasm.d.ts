export interface MjModel {
  nbody: number;
  nu: number;
  ngeom: number;
  geom_type: Int32Array;
  geom_size: Float64Array;
  geom_dataid: Int32Array;
  geom_matid: Int32Array;
  geom_rgba: Float32Array;
  geom_group: Uint8Array;
  mat_rgba: Float32Array;
  mesh_vertadr: Int32Array;
  mesh_vertnum: Int32Array;
  mesh_faceadr: Int32Array;
  mesh_facenum: Int32Array;
  mesh_vert: Float32Array;
  mesh_normal: Float32Array;
  mesh_face: Int32Array;
  actuator_trntype: Int32Array;
  actuator_trnid: Int32Array;
  actuator_ctrlrange: Float64Array;
  jnt_qposadr: Int32Array;
  jnt_dofadr: Int32Array;
}

export interface MjData {
  time: number;
  qpos: Float64Array;
  qvel: Float64Array;
  ctrl: Float64Array;
  xpos: Float64Array;
  geom_xpos: Float64Array;
  geom_xmat: Float64Array;
}

export interface MujocoModule {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
  MjModel: { loadFromXML(path: string): MjModel };
  MjData: new(model: MjModel) => MjData;
  mj_name2id(model: MjModel, type: number, name: string): number;
  mj_resetDataKeyframe(model: MjModel, data: MjData, key: number): void;
  mj_forward(model: MjModel, data: MjData): void;
  mj_step(model: MjModel, data: MjData): void;
}

declare function loadMujoco(): Promise<MujocoModule>;

export default loadMujoco;
